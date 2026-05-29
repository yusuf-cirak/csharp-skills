---
name: csharp-coding-standards
description: Entry-point INDEX & router for the user's personal C# / .NET / ASP.NET Core standards. Contains no rules itself — it dispatches to six focused sub-skills (`csharp-language`, `dotnet-ddd`, `aspnetcore-web-api`, `aspnetcore-input-validation`, `aspnetcore-production-hardening`, `csharp-testing`). Invoke this when you are unsure which C# standard applies, when starting C#/.NET backend work, or when the user references "the coding standards" generically. For a known activity, invoke the specific sub-skill directly (the dispatch table below maps activity → skill). MUST be consulted before writing/editing/reviewing C# (`.cs`/`.csproj`/`.slnx`) when the right sub-skill is not already obvious — even if the user does not mention the standards.
---

# C# Coding Standards — Router

The user's permanent C# rules, split into five focused skills so concerns stop bleeding into each other. **This file holds no rules — it routes.** Load the sub-skill(s) the activity calls for. `csharp-language` is the always-on base; layer the others on top as needed.

## Dispatch table — activity → skill

| You are doing… | Invoke |
|---|---|
| ANY `.cs` edit; records, value objects, DUs, monads, LINQ, immutability, naming, performance | **`csharp-language`** (always) |
| Modeling a domain; aggregates/entities/domain events; module & layer layout (Modular Monolith); where a vertical slice lives | **`dotnet-ddd`** |
| Writing endpoints/handlers/controllers; MediatR commands/queries; slice skeleton; FluentValidation basics; pagination shape | **`aspnetcore-web-api`** |
| Request DTOs/commands/queries; input size/length/depth limits; `InputLimits`; length-typed `Text` VOs; JSON/Kestrel/FormOptions hardening; mandatory validator rules; output encoding | **`aspnetcore-input-validation`** |
| Hardening an exposed/multi-tenant service; rate limiting; idempotency; authn/authz; security headers; crypto; logging/audit; EF hardening; file upload; SSRF; deserialization; observability; CI security | **`aspnetcore-production-hardening`** |
| Writing tests; `[Fact]`/`[Theory]`; fixtures/test doubles; integration tests; setting up a test project (xUnit + Shouldly + NSubstitute + Testcontainers + Bogus + NetArchTest) | **`csharp-testing`** |

Typical combinations:
- New feature slice → `csharp-language` + `dotnet-ddd` + `aspnetcore-web-api` + `aspnetcore-input-validation` + `csharp-testing`.
- Domain model only → `csharp-language` + `dotnet-ddd` (+ `csharp-testing` for its unit tests).
- Security review of a service → `aspnetcore-production-hardening` (+ `aspnetcore-input-validation`).

## Decision Notes (global tie-breakers)

- When unsure between two rule interpretations, pick the one that keeps records immutable, business logic in domain, and errors in `Result<T>`.
- If a third-party library forces a constructor or mutable state, isolate it behind a factory or wrapper rather than leaking the pattern into the domain.

## Shared references (single source of truth)

- `references/value-object-base.md` — `ValueObject`/`ValueObject<T>` base, `Text` example, JSON + EF converters.
- `references/input-limits.md` — the `InputLimits` constants class.
- `references/monads.md` — `Result<T>`/`Option<T>` library selection (YC.Monad first) and usage.
