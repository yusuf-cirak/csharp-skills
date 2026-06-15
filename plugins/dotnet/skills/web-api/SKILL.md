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

## FluentValidation

- Prefer functional / static validators.
- The **mandatory** validator rules (length caps, collection caps, control-char rejection, regex safety, etc.) are owned by `validation` — apply them on every request validator.

## Pagination

Every list/query endpoint paginates — no filterless `GetAll`. Inherit the shared `PagedRequest` base; the base, its validator, and the `MaxPageSize` cap live in `validation`.

## Related skills

- `csharp` — base idioms (records, monads, LINQ).
- `ddd` — module/slice placement, domain logic.
- `validation` — request limits, length-typed VOs, validator rules, serialization hardening.
- `hardening` — rate limiting, authn/authz, headers, error handling, observability.
- `testing` — integration tests (`WebApplicationFactory` + Testcontainers) exercising these endpoints.
