---
name: aspnetcore-web-api
description: User's personal ASP.NET Core Web API rules — owns HOW requests are shaped and handled. Covers the vertical-slice file skeleton (`static class <Name>Command` holding Endpoint/Request/Validator/Handler/Response), FastEndpoints/Minimal API/MediatR handler wiring, FluentValidation basics (prefer functional/static validators), and the pagination request base. Use when writing or editing endpoints, handlers, controllers, MediatR commands/queries, or validators. Use ALONGSIDE `csharp-language` (records/monads). Defers input-size/length/serialization limits to `aspnetcore-input-validation`, security/ops (rate limiting, authn, headers) to `aspnetcore-production-hardening`, and module placement to `dotnet-ddd`.
---

# ASP.NET Core Web API

Owns **how requests are shaped and handled** — the endpoint/handler/slice surface. *Where* a slice sits in the module tree comes from `dotnet-ddd`; record/monad idioms come from `csharp-language`; hard input limits come from `aspnetcore-input-validation`.

## Vertical slice file

One slice file holds Command/Query + Handler + slice-specific DTOs/Validators. (Placement under `Features/<FeatureName>/<Scope>/<Commands|Queries>/` is governed by `dotnet-ddd`.)

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

- Handlers return a monad (`Result<T>`) — see `../csharp-coding-standards/references/monads.md`.
- Every handler signature accepts and propagates `CancellationToken` (full timeout/cancellation rules in `aspnetcore-production-hardening`).

## FluentValidation

- Prefer functional / static validators.
- The **mandatory** validator rules (length caps, collection caps, control-char rejection, regex safety, etc.) are owned by `aspnetcore-input-validation` — apply them on every request validator.

## Pagination

Every list/query endpoint paginates — no filterless `GetAll`. Inherit the shared `PagedRequest` base; the base, its validator, and the `MaxPageSize` cap live in `aspnetcore-input-validation`.

## Related skills

- `csharp-language` — base idioms (records, monads, LINQ).
- `dotnet-ddd` — module/slice placement, domain logic.
- `aspnetcore-input-validation` — request limits, length-typed VOs, validator rules, serialization hardening.
- `aspnetcore-production-hardening` — rate limiting, authn/authz, headers, error handling, observability.
- `csharp-testing` — integration tests (`WebApplicationFactory` + Testcontainers) exercising these endpoints.
