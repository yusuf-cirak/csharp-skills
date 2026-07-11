---
name: web-api
description: User's personal ASP.NET Core Web API rules — owns HOW requests are shaped and handled. Covers the vertical-slice file skeleton (`static class <Name>Command` holding Endpoint/Request/Validator/Handler/Response), FastEndpoints/Minimal API/MediatR handler wiring, FluentValidation basics (prefer functional/static validators), and the pagination request base. Use when writing or editing endpoints, handlers, controllers, MediatR commands/queries, or validators. Use ALONGSIDE `csharp` (records/monads). Defers input-size/length/serialization limits to `validation`, security/ops (rate limiting, authn, headers) to `hardening`, and module placement to `ddd`.
---

# ASP.NET Core Web API

Owns **how requests are shaped and handled** — the endpoint/handler/slice surface. *Where* a slice sits in the module tree comes from `ddd`; record/monad idioms come from `csharp`; hard input limits come from `validation`.

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

## Related skills

- `csharp` — base idioms (records, monads, LINQ).
- `ddd` — module/slice placement, domain logic.
- `validation` — request limits, length-typed VOs, validator rules, serialization hardening.
- `hardening` — rate limiting, authn/authz, headers, error handling, observability.
- `testing` — integration tests (`WebApplicationFactory` + Testcontainers) exercising these endpoints.
