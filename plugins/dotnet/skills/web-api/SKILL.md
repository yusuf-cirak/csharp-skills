---
name: web-api
description: Use when writing or editing ASP.NET Core endpoints, handlers, controllers, mediator commands/queries, or validators, or when wiring/reordering middleware in `Program.cs`. Defers input-size/length limits to `validation`, security/ops to `hardening`, and module placement to `ddd`.
---

# ASP.NET Core Web API

Owns **how requests are shaped and handled** — the endpoint/handler/slice surface, the vertical-slice file skeleton (`static class <Name>Command` holding Endpoint/Request/Validator/Handler/Response), FastEndpoints/Minimal API/mediator handler wiring, FluentValidation basics, the pagination request base, and `Program.cs` middleware pipeline ordering. *Where* a slice sits in the module tree comes from `ddd`; record/monad idioms come from `csharp`; hard input limits come from `validation`.

## Vertical slice file

One slice file holds Command/Query + Handler + slice-specific DTOs/Validators. (Placement under `Features/<FeatureName>/<Scope>/<Commands|Queries>/` is governed by `ddd`.)

Slice skeleton:

```csharp
public static class CreateActivityCommand
{
    public sealed class Endpoint : BaseEndpoint<Request, Result<T>>; // if FastEndpoints
    public sealed record Request() : IRequest<Result<T>>;
    public sealed class Validator : AbstractValidator<Request>;
    public sealed class Handler : IRequestHandler<Request, Result<T>>;
    public sealed record Response(); // only if needed, otherwise reuse DTOs
}
```

- Handlers return a monad (`Result<T>`) — see `../index/references/monads.md`.
- Every handler signature accepts and propagates `CancellationToken` (full timeout/cancellation rules in `hardening`).

**Mediator selection (do this BEFORE scaffolding):** MediatR is commercial from v13. Default to the
free source-gen **`martinothamar/Mediator`**; the `IRequest<T>`/`IRequestHandler<,>`/`IPipelineBehavior<,>`
shapes above are identical either way. If no mediator package is present, **ask the user which to
install**. Full decision rule + AutoMapper→Mapperly mapping guidance: `../index/references/mediator.md`.

## FluentValidation

- Prefer functional / static validators.
- The **mandatory** validator rules (length caps, collection caps, control-char rejection, regex safety, etc.) are owned by `validation` — apply them on every request validator.

## Pagination

Every list/query endpoint paginates — no filterless `GetAll`. Inherit the shared `PagedRequest` base; the base, its validator, and the `MaxPageSize` cap live in `validation`.

Request clamps + result envelope + the EF projection extension (this is the read side; `PagedRequest`'s validator still enforces limits at the boundary):

```csharp
public sealed record PageRequest(int Page = 1, int PageSize = 20) {
    public const int MaxPageSize = 200;
    public int NormalizedPage => Page < 1 ? 1 : Page;
    public int NormalizedPageSize => PageSize is < 1 ? 20 : PageSize > MaxPageSize ? MaxPageSize : PageSize;
    public int Skip => (NormalizedPage - 1) * NormalizedPageSize;
}
public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, long TotalCount) {
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
    public bool HasNext => Page < TotalPages;
    public bool HasPrevious => Page > 1;
}
public static async Task<PagedResult<T>> ToPagedResultAsync<T>(
        this IQueryable<T> query, PageRequest page, CancellationToken ct = default) {
    var total = await query.LongCountAsync(ct);
    var items = await query.Skip(page.Skip).Take(page.NormalizedPageSize).ToListAsync(ct); // order the query first!
    return new(items, page.NormalizedPage, page.NormalizedPageSize, total);
}
```

- Clamp size to `MaxPageSize` — a hostile/empty query must not be able to ask for an unbounded set.
- ALWAYS order before paging; `Skip`/`Take` over an unordered query is non-deterministic.

## Strongly-typed id binding

Minimal API binds a route/query parameter to a strongly-typed id for free when the id implements `IParsable<T>` — no custom `TryParseParameter`/binder needed.

```csharp
// OrderId implements IParsable<OrderId> (Vogen generates it; a hand-rolled id implements it explicitly,
// reached via the IParsable<T> constraint). "/orders/{guid}" binds through OrderId.TryParse.
app.MapGet("/orders/{id}", (OrderId id) => ...);
```

## Middleware pipeline order & registration safety

`Program.cs` composition is sequence-sensitive, and nothing stops a developer from registering a
middleware before a prerequisite it silently depends on — a custom rate-limit/tenant/idempotency
middleware that reads `HttpContext.User` registered *before* `UseAuthentication()`, for instance. It
won't throw; it'll just silently see an unauthenticated principal in prod. Two complementary defenses:

### Canonical order

Exception handling/HSTS → HTTPS redirection → **forwarded headers** (`hardening` → Forwarded Headers —
MUST be first among anything that reads IP/scheme) → static files → `UseRouting()` → CORS → rate
limiting (after routing, so it can partition on the matched route template — `hardening` → Rate
Limiting) → `UseAuthentication()` → `UseAuthorization()` → custom pipeline middleware → endpoints
(`Map*`). Rule of thumb for *where a new middleware goes*: find what `HttpContext` state it reads
(`User`, `RemoteIpAddress`, the matched endpoint, response headers already set by an earlier middleware)
and place it after whatever middleware populates that state.

### Fail fast on a missing prerequisite — follow the framework's own pattern

ASP.NET Core already enforces this for itself: `UseAuthorization()` throws `InvalidOperationException`
at startup if `UseAuthentication()` was never registered, by checking a marker the framework stamps onto
`IApplicationBuilder.Properties` when `UseAuthentication()` runs. Don't rely on the framework's own
(private, version-specific) property key for *your* middleware — define your own marker the same way:

```csharp
public static class IdempotencyMiddlewareExtensions
{
    private const string MarkerKey = "__IdempotencyMiddlewareRegistered"; // this extension's own marker

    public static IApplicationBuilder UseIdempotency(this IApplicationBuilder app)
    {
        if (app.ApplicationServices.GetService<IAuthenticationSchemeProvider>() is not null
            && !app.Properties.ContainsKey("__AuthenticationMiddlewareInvoked")) // set by UseAuthentication()
        {
            throw new InvalidOperationException(
                $"{nameof(UseIdempotency)}() must be called after UseAuthentication() — " +
                "idempotency keys are scoped per authenticated principal.");
        }

        app.Properties[MarkerKey] = true; // so a LATER middleware can depend on this one too
        return app.UseMiddleware<IdempotencyMiddleware>();
    }
}
```

- Stamp `app.Properties[...]` with your own key in every custom `UseX()` extension that something else
  may legitimately depend on — mirrors the framework's approach without coupling to its private keys.
- This is a **startup-time** `InvalidOperationException`, not a silent 3am misbehavior — prefer it over a
  runtime null-check buried in a handler for anything whose correctness depends on pipeline order.
- Applies beyond auth: a custom `UseTenantResolution()` depending on `UseAuthentication()`, a
  `UseRequestLogging()` depending on `UseForwardedHeaders()` for the real client IP, an
  `UseOutputCache()` policy that must sit after authorization, etc. — any ordering dependency a code
  reviewer could plausibly miss is a candidate for this guard, not just auth.

## Related skills

- `csharp` — base idioms (records, monads, LINQ).
- `ddd` — module/slice placement, domain logic.
- `validation` — request limits, length-typed VOs, validator rules, serialization hardening.
- `hardening` — rate limiting, authn/authz, headers, error handling, observability, forwarded headers.
- `testing` — integration tests (`WebApplicationFactory` + Testcontainers) exercising these endpoints.
