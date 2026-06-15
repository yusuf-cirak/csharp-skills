---
name: hardening
description: User's personal FAANG-level production hardening rules for .NET/ASP.NET Core services exposed to untrusted or multi-tenant traffic. Covers tiered/distributed rate limiting & burst protection, idempotency keys & webhook HMAC, authn/authz (short-lived tokens, refresh rotation + reuse detection, global fallback authorize, resource-level checks, tenant-from-claim), security headers & CORS, cryptography (Argon2id/bcrypt, FixedTimeEquals, managed secrets), ProblemDetails error handling, structured logging & audit, EF Core hardening, secure file upload, SSRF defense, XML/deserialization safety, HTTP caching, multi-tenancy isolation, background jobs/outbox, dependency & supply-chain security, OpenTelemetry observability, API versioning/lifecycle, cancellation/timeouts, and CI/test security. Use when hardening a service, doing a security review, configuring middleware/Program.cs, or deploying. Use ALONGSIDE `csharp`, `web-api`, `validation`. DTO-level input size/length limits belong to `validation`.
---

# Production Hardening (FAANG-level)

These rules apply to any service exposed to untrusted networks or multi-tenant traffic. They are non-negotiable defaults; deviations need a written justification on the PR. DTO/serialization input limits are owned by `validation`; this skill covers the network/runtime/ops hardening surface.

## Tiered Rate Limiting & Burst Protection

Rate limiting must be **multi-dimensional**, **distributed**, and **partitioned by principal + endpoint**. A single global bucket is not enough.

Dimensions:

- **Burst guard** — sliding window per `(userId, endpoint)`. Default: **20 req / 5s** with `QueueLimit = 0`. A burst beyond the window is rejected immediately, and an offending principal MUST be soft-banned on that endpoint for **60s** (write the lock key into the same store the limiter uses).
- **Steady quota** — fixed window per user per hour. Reads: 1 000/h, writes: 200/h. Tune per business need.
- **Concurrency cap** — max in-flight requests per user (default 10). Prevents a single principal monopolising worker threads / DB connections.
- **Tier multiplier** — anonymous gets 0.25×; authenticated 1×; internal/service 5×.
- **Failed-auth lockout** — 5 failures / 10 min on login or token endpoints → 30 min lock on `(username, ip)`. Mitigates credential stuffing.

Partition key precedence: authenticated user id → API key id → `hash(client IP + UA)`. Raw IP alone is too coarse (NAT/CGNAT).

Code (.NET 8+ built-in `RateLimiter`):

```csharp
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.Headers.RetryAfter = "60";
        await ctx.HttpContext.Response.WriteAsJsonAsync(
            new ProblemDetails { Status = 429, Title = "Too many requests" },
            cancellationToken: ct);
    };

    // Burst guard: 20 req / 5s per (user, endpoint). Reject (not queue) on overflow.
    o.AddPolicy("burst", httpContext =>
    {
        var userKey = httpContext.User.FindFirst("sub")?.Value
                      ?? httpContext.Connection.RemoteIpAddress?.ToString()
                      ?? "anon";
        var partition = $"{userKey}|{httpContext.Request.Path}";
        return RateLimitPartition.GetSlidingWindowLimiter(
            partition,
            _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 20,
                Window = TimeSpan.FromSeconds(5),
                SegmentsPerWindow = 5,
                QueueLimit = 0,
            });
    });

    // Steady read quota per user per hour
    o.AddPolicy("quota-read", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.User.FindFirst("sub")?.Value ?? "anon",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 1_000,
                Window = TimeSpan.FromHours(1),
                QueueLimit = 0,
            }));

    // Concurrency cap per user
    o.AddPolicy("concurrency", httpContext =>
        RateLimitPartition.GetConcurrencyLimiter(
            httpContext.User.FindFirst("sub")?.Value ?? "anon",
            _ => new ConcurrencyLimiterOptions { PermitLimit = 10, QueueLimit = 0 }));
});

app.UseRateLimiter();
```

Endpoint composition:

```csharp
app.MapPost("/orders", Handler)
   .RequireRateLimiting("burst")
   .RequireRateLimiting("quota-write")
   .RequireRateLimiting("concurrency");
```

Soft-ban after burst hit: implement a small middleware or `OnRejected` extension that, on the second consecutive rejection within the window, writes `lock:{userKey}:{path}` with TTL 60s into the shared store; a guard middleware short-circuits with 429 while the lock exists.

**Backend choice:**

- **In-memory** (`AddRateLimiter` default) — dev / single-instance only. Each process has its own counter; behind a load balancer the limit is multiplied by N.
- **Distributed (Redis)** — required for any multi-instance prod deployment. Use a community package such as `RedisRateLimiting`, or wrap `StackExchange.Redis` with a Lua script (`INCR` + `EXPIRE`) for atomicity.

```csharp
// Distributed example (RedisRateLimiting package)
services.AddRedisRateLimiting(o =>
{
    o.ConnectionMultiplexerFactory = sp => sp.GetRequiredService<IConnectionMultiplexer>();
});

// Hand-rolled sliding window using Redis sorted sets (Lua)
// KEYS[1]=partition  ARGV[1]=nowMs  ARGV[2]=windowMs  ARGV[3]=permitLimit  ARGV[4]=requestId
// redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1] - ARGV[2])
// local count = redis.call('ZCARD', KEYS[1])
// if count >= tonumber(ARGV[3]) then return 0 end
// redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
// redis.call('PEXPIRE', KEYS[1], ARGV[2])
// return 1
```

Failed-auth lockout — store fail counter in Redis with TTL 10 min; on the 5th fail, write `auth-lock:{user}:{ip}` with TTL 30 min and reject downstream. Reset on successful login.

## Idempotency

Mutation endpoints (`POST`/`PUT`/`PATCH`/non-idempotent `DELETE`) require an `Idempotency-Key` header. Server stores `key → (request-hash, status, response)` in Redis with TTL 24 h.

- Same key + same body hash → replay cached response.
- Same key + different body hash → 409 (replay with mismatched payload).
- Missing key on a mutation → 400.

```csharp
public sealed class IdempotencyMiddleware(IIdempotencyStore store)
{
    public async Task InvokeAsync(HttpContext ctx, RequestDelegate next)
    {
        if (!HttpMethods.IsPost(ctx.Request.Method) && !HttpMethods.IsPut(ctx.Request.Method)
            && !HttpMethods.IsPatch(ctx.Request.Method))
        { await next(ctx); return; }

        if (!ctx.Request.Headers.TryGetValue("Idempotency-Key", out var key))
        {
            await Results.Problem("Idempotency-Key required", statusCode: 400).ExecuteAsync(ctx);
            return;
        }

        var bodyHash = await HashBodyAsync(ctx.Request);
        if (await store.TryReplayAsync(key!, bodyHash, ctx.Response)) return;

        await next(ctx);
        if (ctx.Response.StatusCode is >= 200 and < 500)
            await store.SaveAsync(key!, bodyHash, ctx.Response, TimeSpan.FromHours(24));
    }
}
```

Inbound webhooks: require HMAC signature + `X-Timestamp` (reject if `|now - ts| > 5 min`) + nonce store (24 h replay window).

## AuthN / AuthZ

- Access token TTL ≤ 15 min. Refresh token TTL ≤ 30 days with **rotation on every use**.
- **Refresh-token reuse detection**: if an already-rotated refresh token is presented, revoke the entire token family and force re-login. This is the canonical defence against stolen refresh tokens.
- `[Authorize]` registered **globally** as fallback policy; `[AllowAnonymous]` is opt-in:
  ```csharp
  builder.Services.AddAuthorizationBuilder()
      .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
  ```
- Resource-level authorization in the handler via `IAuthorizationService.AuthorizeAsync(user, resource, policy)`. Endpoint-level `[Authorize(Policy=...)]` alone is insufficient for instance-scoped permission (e.g. "can edit *this* order").
- **Tenant id MUST come from a token claim**, never from route/query/body. Expose via `ICurrentTenant` populated from `HttpContext.User`.
- `mTLS` for service-to-service traffic inside the cluster.

JWT bearer validation — hardened defaults (config-driven: symmetric secret for dev/test, OIDC `Authority`+JWKS for prod):

```csharp
o.MapInboundClaims = false; // keep "sub" as "sub" — rate-limiter, audit and log enrichment read it raw
o.TokenValidationParameters = new()
{
    ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true,
    ValidateIssuerSigningKey = true, RequireSignedTokens = true, RequireExpirationTime = true,
    ClockSkew = TimeSpan.FromSeconds(30), // the 5-minute default keeps expired tokens alive far too long
    NameClaimType = "sub", RoleClaimType = "role",
};
```

- **Secure by default**: register the authenticated fallback policy (above). It also applies to **unmatched routes**, so an anonymous request to an unknown path returns **401, not 404** (route existence is not leaked). Mark health/docs endpoints `AllowAnonymous`.
- **Scope authorization**: read OAuth scopes from both conventions — a space-delimited `scope` claim **and** repeated `scp` claims. Expose a `.RequireScope("orders:write")` endpoint helper (a policy + `IAuthorizationHandler`) following the same convention as `.RequireIdempotency()`. Roles use the native `.RequireAuthorization(p => p.RequireRole(...))`.
- **401/403 as problem+json**: wire `JwtBearerEvents.OnChallenge` (401) and `OnForbidden` (403) to write RFC 9457 `ProblemDetails` via `IProblemDetailsService` (consistent with the global handler — same `traceId`/`correlation_id` stamping), set `WWW-Authenticate` on challenge, and **never leak token-validation specifics** to the caller (`OnAuthenticationFailed` stays silent in prod; detail lives in the trace/logs).

## Security Headers + CORS

```csharp
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
    h["Content-Security-Policy"]   = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    h["X-Content-Type-Options"]    = "nosniff";
    h["X-Frame-Options"]           = "DENY";
    h["Referrer-Policy"]           = "no-referrer";
    h["Permissions-Policy"]        = "geolocation=(), camera=(), microphone=()";
    h["Cross-Origin-Opener-Policy"] = "same-origin";
    h["Cross-Origin-Resource-Policy"] = "same-origin";
    h.Remove("Server");
    await next();
});
```

CORS: explicit `WithOrigins(...)` list. `AllowAnyOrigin()` combined with `AllowCredentials()` is **forbidden** (browsers reject it, and it is a clear sign of misconfiguration).

## Forwarded Headers / Real Client IP

Behind a load balancer / ingress, `RemoteIpAddress` is the proxy, not the client — which silently breaks rate-limit partitioning, `client_ip` audit/logs, and any IP allowlist. `UseForwardedHeaders()` must run **first** in the pipeline (before anything reads the IP or scheme).

- **Anti-spoofing**: trust `X-Forwarded-For`/`-Proto` **only** from explicitly configured proxies — set `KnownProxies` / `KnownIPNetworks` (renamed from `KnownNetworks` in .NET 10) to your edge ranges. Outside Development, if none are configured, the forwarded headers are **ignored** rather than blindly trusted (an attacker must not be able to forge their own client IP). In Development keep the framework default (loopback trusted) so local tooling works.

```csharp
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.ForwardLimit = 1; // one trusted hop (the edge)
    if (!builder.Environment.IsDevelopment())
    {
        o.KnownIPNetworks.Clear(); o.KnownProxies.Clear();
        foreach (var p in configuredProxies) o.KnownProxies.Add(IPAddress.Parse(p));
    }
});
app.UseForwardedHeaders(); // FIRST
```

## Cryptography

- Password hashing: **Argon2id** (preferred) or **bcrypt cost ≥ 12**. PBKDF2 only when FIPS-required (≥ 600 000 iterations SHA-256).
- General hashing: SHA-256 or SHA-3. `MD5` / `SHA1` / `DES` / `RC4` are **forbidden** outside legacy interop.
- Random tokens/nonces: `RandomNumberGenerator.GetBytes(32)`. `System.Random` is **forbidden** for any security-sensitive value.
- Secret comparison (HMAC, tokens): `CryptographicOperations.FixedTimeEquals`. Never `==` or `SequenceEqual`.
- Secrets from a managed store (Azure Key Vault / AWS Secrets Manager / HashiCorp Vault). Plain secrets in `appsettings.*.json` committed to source control are **forbidden**.

## Error Handling

- All errors emit `ProblemDetails` (**RFC 9457**, the current problem-details RFC superseding 7807). `application/problem+json`.
- Implement a global `IExceptionHandler` + `AddProblemDetails`, and use **`CustomizeProblemDetails` to stamp `traceId` + `correlation_id` (+ `instance` = path) on EVERY problem response** — handler-produced and framework-produced (404, 400 model-binding, 415) alike — so all error payloads look identical and are traceable.
- Production: response carries title, status, traceId, correlation_id. Stack trace and inner exception detail go to logs only, never to the wire.
- Map known cases: `ValidationException` → 400 `ValidationProblemDetails` (field→errors, see `validation`); **client abort** (cancellation when the client disconnected) → **499**, not 500; `BadHttpRequestException` → its own status.
- `traceId = Activity.Current?.TraceId.ToString()`. Never let DB / framework messages leak.

## Structured Logging & Audit

- **Logging mechanics live in `observability`** (OTel-native `ILogger`→OTLP, key/mask/baggage processors, JSON console, tail sampling). Prefer OTel-native; Serilog only when that isn't possible. Every line carries `trace_id`, `correlation_id`, `user_id`, `route`. This section owns the **redaction policy** that pipeline must enforce.
- **Never log**: passwords, tokens, `Authorization` / `Cookie` headers, full request/response bodies, full PII. Header logging is an **allow-list** (only known-safe headers); bodies off in Production.
- **Query strings leak secrets** — `HttpLoggingFields.RequestQuery` logs the raw query, which can carry OAuth `code`/`access_token`, signed-URL `sig`/`signature`, and `api_key`. Never enable it wholesale: log the query through an `IHttpLoggingInterceptor` that **redacts sensitive parameter values** (keep names + safe values for debugging, mask the rest to `***`).
- **Audit log** in a separate, append-only sink (and ideally signed): auth events (login, logout, failure), role/permission changes, data export, money movement, admin actions.

## EF Core Hardening

- **No `FromSqlRaw` with string concatenation.** Use `FromSqlInterpolated` (parameterised) or no raw SQL.
- Command timeout: read paths 10 s, write paths 30 s. Configure in `DbContext` options.
- Soft-delete + tenant via global query filter. `.IgnoreQueryFilters()` requires a written justification + audit entry.
- Read queries default to `AsNoTracking` (or `AsNoTrackingWithIdentityResolution` where dedupe matters).
- Connection pool sized; mirror with DB-side `statement_timeout` and `idle_in_transaction_session_timeout`.

## File Upload

- Validate **magic bytes**, not extension or `Content-Type` header (both client-controlled).
- AV scan (ClamAV / Defender) on the upload pipeline; quarantine on positive.
- Store outside the webroot; generate server-side filename; never echo client filename in URLs.
- Re-encode images server-side to strip EXIF and defuse decompression bombs (e.g. ImageSharp with pixel-count cap).
- Allowlist of `Content-Type`; reject everything else.
- Per-upload size limit via `[RequestSizeLimit]` (see `validation` section 6).

## SSRF Defense

- Outbound `HttpClient` registered with a `DelegatingHandler` that resolves the host and rejects if the IP falls in `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (cloud metadata), `::1`, `fc00::/7`.
- DNS rebinding protection: resolve once, pin the IP for the duration of the call.
- Outbound connect + total timeout mandatory. Default 5 s connect / 30 s total.
- `AllowAutoRedirect = false` or constrain redirects to the same origin.

## XML / Deserialization Safety

- `XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }`.
- `BinaryFormatter`, `SoapFormatter`, `NetDataContractSerializer`, `LosFormatter` are **forbidden** (RCE class). Use `System.Text.Json` or `MessagePack` with explicit contracts.
- If Newtonsoft.Json must be used: `TypeNameHandling = None`. Never `Auto` / `All` / `Objects`.

## Transport (compression & decompression)

- **Request decompression**: `AddRequestDecompression()` + `UseRequestDecompression()` (early, before the body is read) so clients may send `Content-Encoding: br/gzip/deflate`. The decompressed stream stays bounded by Kestrel `MaxRequestBodySize` — that cap is the decompression-bomb defence.
- **Response compression**: Brotli + gzip, but `EnableForHttps = false` — compressing secret-bearing responses over TLS enables the **BREACH** attack. Opt in per response where safe.
- **Output cache** (`AddOutputCache`) for cacheable GETs; never cache authenticated/user-varying responses (see HTTP Caching).

## HTTP Caching

- Authenticated responses default to `Cache-Control: no-store`.
- `Vary: Authorization` on any response that varies per user.
- Use `ETag` for conditional GET on read-heavy public endpoints.

## Multi-Tenancy

- Tenant id flow: token claim → `ICurrentTenant` → EF global query filter → repository / handler.
- Cross-tenant query handlers (admin tooling) require an explicit `[CrossTenant]` marker **plus** an audit-log entry on every call.
- Defence in depth: row-level security at the DB (Postgres RLS / SQL Server security predicates) in addition to the query filter — never rely on the app layer alone.

## Background Jobs & Messaging

- Handlers MUST be idempotent (dedupe via message id table or natural key).
- Retry: exponential backoff with jitter, bounded attempts (default 5). Poison messages → DLQ; alert on DLQ depth.
- Cross-aggregate writes use the **Outbox pattern** — never dual-write to DB + broker.

## Dependency & Supply Chain

- Central package versions in `Directory.Packages.props`.
- CI: `dotnet list package --vulnerable --include-transitive` — **fail the build** on any CVE.
- Generate CycloneDX SBOM in the release pipeline.
- Pre-commit secret scanning (`gitleaks` / `trufflehog`).
- Roslyn analyzers: `Microsoft.CodeAnalysis.NetAnalyzers`, `SecurityCodeScan.VS2019` (or equivalent), `Roslynator`. In `Directory.Build.props`:
  ```xml
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  <AnalysisLevel>latest</AnalysisLevel>
  <AnalysisMode>All</AnalysisMode>
  ```

## Observability

Owned by the **`observability`** skill — OpenTelemetry-native traces/metrics/logs over OTLP, `correlation_id`/baggage, health probes, and SLO/burn-rate alerting all live there. From a hardening standpoint just enforce: telemetry exists and is wired; `correlation_id` echoed; **RED + USE** with SLOs and multi-window burn-rate alerts; redaction policy (above) honoured by the logging pipeline.

## API Versioning & Lifecycle

- `/v1/`, `/v2/` URL versioning **or** `Api-Version` header — pick one and stick with it across all services.
- Deprecation: emit `Deprecation: true` and `Sunset: <RFC1123-date>` headers on legacy versions.
- Per-endpoint kill switch via feature flag (`IFeatureManager` / LaunchDarkly / Unleash).

## Cancellation & Timeouts

- Every handler signature accepts `CancellationToken` and propagates it (`DbContext`, `HttpClient`, downstream calls). Handlers that ignore the token are blocked in review.
- Per-request timeout middleware: 30 s default; lower for read paths.
- Graceful shutdown: subscribe to `IHostApplicationLifetime.ApplicationStopping` to drain in-flight work; configure host `ShutdownTimeout` greater than the drain budget. Pair it with a readiness check that flips Unhealthy on `ApplicationStopping` so the LB drains first (see `observability` → Health checks).

## CI / Test Security

- SAST: CodeQL or SonarCloud on every PR.
- DAST: OWASP ZAP smoke against staging on each release.
- Snapshot tests asserting security headers, `ProblemDetails` shape, and the 429 envelope.
- OpenAPI schema-drift test (`Swashbuckle.AspNetCore.Cli`) — fail if undocumented endpoints appear.
- Critical paths: mutation testing (`Stryker.NET`).

## Related skills

- `observability` — OTel-native traces/metrics/logs, correlation/baggage, health probes, SLO/alerting (the logging pipeline that enforces this skill's redaction policy).
- `validation` — DTO/serialization input limits, `InputLimits`, length-typed VOs.
- `web-api` — endpoint/handler shape these policies attach to.
- `ddd` — outbox/domain-event and module boundaries.
- `csharp` — base idioms (records, monads, performance).
- `testing` — how tests are written; the CI/Test Security gates here (coverage, Stryker, header/`429` snapshots) are exercised by that standard.
