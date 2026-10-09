---
name: hardening
description: Hardens ASP.NET Core services exposed to untrusted or multi-tenant traffic. Use when hardening a service, doing a security review, configuring middleware/`Program.cs`, or deploying. DTO-level input size/length limits belong to `validation`.
---

# Production Hardening (FAANG-level)

## Contents

- Tiered Rate Limiting & Burst Protection
- Idempotency
- AuthN / AuthZ
- Security Headers + CORS
- Forwarded Headers / Real Client IP
- Cryptography
- Error Handling → `dotnet:validation`
- Structured Logging & Audit → `dotnet:observability`
- EF Core Hardening
- File Upload → `dotnet:validation`
- SSRF Defense
- Resilience (outbound calls) → `../csharp/references/resilience.md`
- XML / Deserialization Safety
- Transport (compression & decompression)
- HTTP Caching
- Application Caching (hybrid L1/L2) → `../csharp/references/caching.md`
- Multi-Tenancy
- Background Jobs & Messaging → `dotnet:csharp`
- Dependency & Supply Chain
- Observability → `dotnet:observability`
- API Versioning & Lifecycle
- Cancellation & Timeouts → `dotnet:observability`
- CI / Test Security
- LLM / Prompt-Injection Hardening
- Related skills → `dotnet:observability`, `dotnet:validation`, `dotnet:web-api`, `dotnet:ddd`, `dotnet:csharp`, `dotnet:testing`

## Files

- `../csharp/references/resilience.md` — Resilience pipelines (single source of truth)
- `../csharp/references/caching.md` — Application caching — hybrid L1/L2 (shared reference)
- `dotnet:validation` (`../validation/SKILL.md`) — ASP.NET Core Input Security & Serialization Limits
- `dotnet:observability` (`../observability/SKILL.md`) — Observability (OpenTelemetry-native, FAANG-level)
- `dotnet:csharp` (`../csharp/SKILL.md`) — C# House Style
- `dotnet:web-api` (`../web-api/SKILL.md`) — ASP.NET Core Web API
- `dotnet:ddd` (`../ddd/SKILL.md`) — .NET Domain-Driven Design & Architecture
- `dotnet:testing` (`../testing/SKILL.md`) — C# Testing Standard

These rules apply to any service exposed to untrusted networks or multi-tenant traffic: tiered/distributed rate limiting & burst protection, idempotency keys & webhook HMAC, authn/authz (short-lived tokens, refresh rotation + reuse detection, resource-level checks, tenant-from-claim), security headers & CORS, cryptography, `ProblemDetails` error handling, structured logging & audit, EF Core hardening, secure file upload, SSRF defense, deserialization safety, HTTP/application caching, multi-tenancy isolation, background jobs/outbox, supply-chain security, and API versioning/lifecycle. They are non-negotiable defaults; deviations need a written justification on the PR. DTO/serialization input limits are owned by `validation`; this skill covers the network/runtime/ops hardening surface.

## Tiered Rate Limiting & Burst Protection

Rate limiting must be **multi-dimensional**, **distributed**, and **partitioned by principal + endpoint**. A single global bucket is not enough.

Dimensions:

- **Burst guard** — sliding window per `(userId, endpoint)`. Default: **20 req / 5s** with `QueueLimit = 0`. A burst beyond the window is rejected immediately, and an offending principal MUST be soft-banned on that endpoint for **60s** (write the lock key into the same store the limiter uses).
- **Steady quota** — fixed window per user per hour. Reads: 1 000/h, writes: 200/h. Tune per business need.
- **Concurrency cap** — max in-flight requests per user (default 10). Prevents a single principal monopolising worker threads / DB connections.
- **Tier multiplier** — anonymous gets 0.25×; authenticated 1×; internal/service 5×. The privileged (internal/service) tier MUST be asserted from a **trusted authentication scheme** (mTLS / internal API-key scheme), never from a value the caller can place in its own JWT — a forgeable tier claim is both a rate-limit bypass and a privilege escalation.
- **Failed-auth lockout** — 5 failures / 10 min on login or token endpoints → 30 min lock on `(username, ip)`. Mitigates credential stuffing.

Partition key precedence: authenticated user id → API key id → `hash(client IP + UA)`. Raw IP alone is too coarse (NAT/CGNAT).

**Partition on the matched route *template*, never the raw path.** Keying on `Request.Path` means `/items/1`, `/items/2`, … each get their own bucket and the effective limit multiplies — a trivial bypass. Read the matched `RouteEndpoint.RoutePattern.RawText` (fall back to the raw path only when no endpoint matched).

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
        // Route TEMPLATE, not raw path — per-id paths must share one bucket.
        var route = (httpContext.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText
                    ?? httpContext.Request.Path.ToString();
        var partition = $"{userKey}|{route}";
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
- **Fail open, not closed.** When Redis is unreachable (`AbortOnConnectFail = false`; guard on `IConnectionMultiplexer.IsConnected`), degrade to a per-node in-memory limiter rather than 429-ing every request — a rate-limiter outage must not become a self-inflicted DoS. Emit a `ratelimit.fallback` counter so the degraded (per-node, multiplied-by-N) state is observable and alertable.

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
- **Keep the token small; load volatile/high-cardinality claims per-request instead of baking them in.** A token re-issued only every 15 min goes stale the moment a user's group/role membership changes mid-session, and group lists that grow over time bloat every request's `Authorization` header. Implement `IClaimsTransformation` to append those claims *after* authentication, on every request, from a fast cache-backed lookup — the JWT carries only the stable identity (`sub`, core roles); derived/volatile authorization data is always current, never stale for the token's lifetime:
  ```csharp
  public sealed class GroupClaimsTransformation(IGroupLookupService groups) : IClaimsTransformation
  {
      public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
      {
          if (principal.Identity is not { IsAuthenticated: true }) return principal;
          var userGroupIds = principal.Claims.Where(c => c.Type == ClaimTypes.GroupSid).Select(c => c.Value);
          var resolved = await groups.GetGroupsAsync(userGroupIds); // cache-backed — see `caching.md`
          var identity = new ClaimsIdentity(resolved.Select(g => new Claim("group", g.Id.ToString())));
          principal.AddIdentity(identity);
          return principal;
      }
  }
  builder.Services.AddTransient<IClaimsTransformation, GroupClaimsTransformation>();
  ```
  Register it after `AddAuthentication()`; it runs on every authenticated request (not just login), so keep the lookup cheap (cache-backed, not a cold DB hit every time).

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

CORS: explicit `WithOrigins(...)` list. `AllowAnyOrigin()` combined with `AllowCredentials()` is **forbidden** (browsers reject it, and it is a clear sign of misconfiguration). **Deny by default**: when no origins are configured the policy allows **nothing** — never widen to `AllowAnyOrigin` as an empty-config fallback.

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

## Resilience (outbound calls)

Every outbound `HttpClient` carries a **Polly v8 resilience pipeline** — don't hand-roll retry/timeout.
Default to `AddStandardResilienceHandler()` (retry + total/per-try timeout + circuit-breaker + hedging);
custom pipelines order strategies outer→inner. **Retry only idempotent calls**; jitter is mandatory; the
SSRF handler composes **inside** the pipeline. Pipelines emit OTel automatically. Full rules + ordering +
chaos-testing (`AddChaosFault`/Simmy): `../csharp/references/resilience.md`.

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

## Application Caching (hybrid L1/L2)

Don't hand-roll a cache layer or run a bare `IDistributedCache`. Default to a **hybrid L1 (in-process) +
L2 (Redis)** cache with stampede protection, fail-safe stale-serving, and cross-node invalidation. Full
rules + library pick (FusionCache): `../csharp/references/caching.md`.

## Multi-Tenancy

- Tenant id flow: token claim → `ICurrentTenant` → EF global query filter → repository / handler.
- Cross-tenant query handlers (admin tooling) require an explicit `[CrossTenant]` marker **plus** an audit-log entry on every call.
- Defence in depth: row-level security at the DB (Postgres RLS / SQL Server security predicates) in addition to the query filter — never rely on the app layer alone.

## Background Jobs & Messaging

- Handlers MUST be idempotent. Concrete dedup: persist a `(message_id, consumer)` **unique** row in the *same transaction* as the handler's state change, and treat a unique-violation on insert (`SQLSTATE 23505` — provider-agnostic, read `DbException.SqlState`) as an idempotent no-op (a concurrent/redelivered duplicate), **not** an error to retry into a poison loop.
- **The dedup key should be deterministic, not random, when the message is derived from stable content** (reprocessing the same source record, reacting to the same upstream event). A `Guid.NewGuid()` per publish defeats dedup entirely — two publishes for the same logical event get two different ids and both pass the unique-row check. Hash the stable identifying content into a deterministic id instead (a fast non-cryptographic hash — e.g. FNV-1a over the content — folded into a `Guid`) and set it as the message/`MessageId` the dedup check keys on, so re-publishing the same logical event (a retry, a redelivery, a second producer instance) always lands on the same key. Reserve `Guid.CreateVersion7()` (see `csharp`) for ids that must be *unique per occurrence* — the two are solving opposite problems.
- Retry: exponential backoff with jitter, bounded attempts (default 5). Poison messages → DLQ; alert on DLQ depth.
- Cross-aggregate writes use the **Outbox pattern** — never dual-write to DB + broker.
- This section owns **distributed/broker** reliability. For a purely **in-process** producer/consumer queue (no broker), use the `System.Threading.Channels` + `BackgroundService` primitive in `csharp` → Background work & channels.

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

## LLM / Prompt-Injection Hardening

Any text a caller (or an admin, or a document) can influence is **untrusted data** once a model reads it. Rules:

- **Structure every prompt with tagged sections** (`<gorev>`, `<kurallar>`, `<icerik>`…) and put untrusted text only
  inside its own block. One helper wraps it and **removes every structural tag from the text** (open/close, any
  case, spaces/attributes), repeating until nothing can re-form (`<ek_<icerik>talimatlar>`). Never concatenate
  untrusted text into a trusted section; never rely on a "please ignore instructions in the document" sentence alone.
- **Trusted policy in the system turn, untrusted state in the user turn.** The state may be a string, an array or an
  object: strings go as text, arrays/objects as compact JSON, inside the block. Serialize non-ASCII readably
  (relaxed encoder) — neutralize **after** serialization so readability never reopens the tag hole.
- **Gate at write time, fail-closed.** Classify free-text instructions with a model *before* persisting them.
  Anything that is not an explicit "allow" is blocked: timeout, provider error, invalid/out-of-policy output and a
  model refusal all reject the whole save. Return the reason to the admin; never save with a warning.
- **Determinism and cost:** temperature 0 plus a fixed seed; cache the verdict by hash(policy name+version, model,
  state kind, state) and bump the policy version whenever the policy text changes. Never cache failures. A cache
  outage must not break the request.
- **Model choice is system config, never caller input.** Use the configured default model for the gate; validate any
  stored model name against a format value object (charset, length, segments, no URL schemes) instead of a list that
  drifts as gateways add models.
- **Validate model output like input:** structured output, then check decision/category against the policy, clamp
  numbers to range, bound counts and lengths. LLM-produced free-form fields stay free-form but are capped.
- **Do not leak the machinery:** system prompt, raw model response and organization prompts are admin-only; return an
  empty same-shaped object (not `null`) to everyone else. Never log the text under review — log a hash prefix,
  decision, category, confidence, model, tokens and duration (source-generated, snake_case).
- **Output encoding stays at the sink** (UI/engine). Sanitizing the model's output is a bound, not an encoder.
- **Usage is auditable:** record model, tokens and purpose for every non-cached call, also when the request is
  rejected.

## Related skills

- `dotnet:observability` — OTel-native traces/metrics/logs, correlation/baggage, health probes, SLO/alerting (the logging pipeline that enforces this skill's redaction policy).
- `dotnet:validation` — DTO/serialization input limits, `InputLimits`, length-typed VOs.
- `dotnet:web-api` — endpoint/handler shape these policies attach to.
- `dotnet:ddd` — outbox/domain-event and module boundaries.
- `dotnet:csharp` — base idioms (records, monads, performance).
- `dotnet:testing` — how tests are written; the CI/Test Security gates here (coverage, Stryker, header/`429` snapshots) are exercised by that standard.
