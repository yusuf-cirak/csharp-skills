---
name: index
description: Entry-point INDEX & router for the user's personal C# / .NET / ASP.NET Core standards. Contains no rules itself — it dispatches to seven focused sub-skills (`csharp`, `ddd`, `web-api`, `validation`, `hardening`, `observability`, `testing`). Invoke this FIRST whenever any C# / .NET / ASP.NET Core work is starting (writing, editing, reviewing, or generating `.cs` / `.csproj` / `.slnx` / `.razor` / `.cshtml` / `Directory.Build.props` / `global.json`), or whenever the user references "the coding standards" generically. Reads the dispatch table below, then invokes EVERY sub-skill the activity calls for (multiple usually apply). MUST be consulted before touching C# even if the user does not mention the standards.
---

# C# / .NET Standards — Router (dotnet:index)

The user's permanent C# rules, split into seven focused sub-skills so concerns stop bleeding into each other. **This file holds no rules — it routes.** Read the dispatch table; invoke EVERY sub-skill the current activity matches. `csharp` is the always-on base layer; layer the others on top as needed.

## How to use this router

1. Identify what the current task touches (any combination of: domain modeling, endpoints/handlers, request DTOs/validation, ops/security hardening, tests).
2. Look up each matching row in the dispatch table below.
3. Invoke EVERY matched sub-skill via the Skill tool (`dotnet:<short>`). Do not stop at one — combinations are the norm.
4. Always also invoke `dotnet:csharp` for any `.cs` edit.

## Dispatch table — activity → skill

| You are doing… | Invoke |
|---|---|
| ANY `.cs` edit; records, value objects, DUs, monads, LINQ, immutability, naming, performance; `TimeProvider`; keyed DI; Channels/`BackgroundService`; modern C# (collection expr, primary ctors, `required`, `field`); source-gen JSON/AOT; concurrency primitives | **`dotnet:csharp`** (always) |
| Modeling a domain; aggregates/entities/domain events; strongly-typed ids (Vogen); EF value-object persistence; domain-event dispatch via `SaveChangesInterceptor`; module & layer layout (Modular Monolith); where a vertical slice lives | **`dotnet:ddd`** |
| Writing endpoints/handlers/controllers; mediator commands/queries (which mediator to pick — MediatR licensing); slice skeleton; FluentValidation basics; pagination shape | **`dotnet:web-api`** |
| Request DTOs/commands/queries; input size/length/depth limits; `InputLimits`; length-typed `Text` VOs; JSON/Kestrel/FormOptions hardening; mandatory validator rules; output encoding | **`dotnet:validation`** |
| Hardening an exposed/multi-tenant service; rate limiting; idempotency; authn/authz (JWT bearer hardening, scopes); forwarded headers; security headers; crypto; ProblemDetails/error handling; HTTP-logging redaction; EF hardening; **resilience pipelines (Polly v8 outbound calls)**; file upload; SSRF; deserialization; CI security | **`dotnet:hardening`** |
| Instrumenting a service; OpenTelemetry traces/metrics/logs; `ActivitySource`/`Meter`; correlation_id/baggage; structured logging processors + source-gen `[LoggerMessage]`; sampling; health checks/probes; SLO & burn-rate alerting; telemetry wiring in `Program.cs` | **`dotnet:observability`** |
| Writing tests; `[Fact]`/`[Theory]`; fixtures/test doubles; integration tests; setting up a test project (xUnit + Shouldly + NSubstitute + Testcontainers + Bogus + NetArchTest) | **`dotnet:testing`** |

Typical combinations:

- **New feature slice (end-to-end)** → `csharp` + `ddd` + `web-api` + `validation` + `testing`.
- **Domain model only** → `csharp` + `ddd` (+ `testing` for its unit tests).
- **Endpoint/handler change without new domain** → `csharp` + `web-api` + `validation` (+ `testing`).
- **Security review of a service** → `hardening` (+ `validation` for the DTO surface).
- **New test project / test fixture** → `testing` (+ `csharp` for idioms).
- **Instrumenting / telemetry / health checks** → `observability` (+ `csharp` for constants & alloc-minimal processors, + `hardening` for redaction policy).
- **New service bootstrap / Program.cs wiring** → `hardening` + `observability` + `validation` (+ `csharp`).
- **Production rollout / deployment hardening** → `hardening` + `observability` (+ `validation` for input limits).

## Decision Notes (global tie-breakers)

- When unsure between two rule interpretations, pick the one that keeps records immutable, business logic in domain, and errors in `Result<T>`.
- If a third-party library forces a constructor or mutable state, isolate it behind a factory or wrapper rather than leaking the pattern into the domain.

## Shared references (single source of truth)

These live under `references/` next to this router; sub-skills link to them by relative path (`../index/references/…`):

- `references/value-object-base.md` — `ValueObject`/`ValueObject<T>` base, `Text` example, JSON + EF converters.
- `references/input-limits.md` — the `InputLimits` constants class.
- `references/monads.md` — `Result<T>`/`Option<T>` library selection (YC.Monad first) and usage.
- `references/state-as-types.md` — polymorphic state machine (Transfer/FourEyesApproval): capability interfaces, `Try*` transitions, construction-time guard, relational two-model + document-store JSON persistence.
- `references/mediator.md` — which mediator to use (MediatR commercial from v13 → default `martinothamar/Mediator`, ask if none), AutoMapper→Mapperly, Wolverine.
- `references/resilience.md` — Polly v8 / `AddStandardResilienceHandler` pipelines, strategy ordering, chaos testing.
- `references/ef-core-data-access.md` — EF Core performance (pooling, bulk, compiled/split queries) + value-object/strongly-typed-id persistence.
