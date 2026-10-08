---
name: csharp
description: C# house style. Use before writing, editing, or reviewing any C#/.NET code (`.cs`, `.csproj`, `.slnx`, `Directory.Packages.props`) and for questions about C# idioms or the coding standards. Entry point to the ddd, web-api, validation, hardening, observability, and testing skills.
---

# C# House Style

Permanent C# rules for this codebase. Every `.cs` edit follows the core below; branch topics sit one pointer away in `references/`; sibling skills own their own surface. When a framework or language version blocks a rule, write the closest equivalent and say why.

## Route first

Before the first edit, and again each time the work changes shape, collect signals from what you **touch** (paths, project files), what you **write** (constructs), and what the **user asks**. Invoke every sibling whose signal is present, via the Skill tool. Combinations are the norm; when a signal is ambiguous, load the skill.

| Skill | Load when you see… |
|---|---|
| `dotnet:ddd` | entities, aggregates, domain events, strongly-typed ids; `Domain/`, `Modules/<X>/`, `BuildingBlocks/`; "module", "layer", "bounded context"; deciding **where** new code lives |
| `dotnet:web-api` | `Controllers/`, `Endpoints/`, `[Http*]`, `MapGet/MapPost`, `IRequestHandler`/mediator, slice files, `Program.cs` middleware order, pagination shape |
| `dotnet:validation` | a request DTO/command/query; any caller-supplied string or file; `AbstractValidator`; length/size/depth limits; `Regex`; `JsonSerializerOptions`/Kestrel/`FormOptions`; output encoding |
| `dotnet:hardening` | auth/authz, secrets, rate limiting, idempotency, caching, outbound HTTP/queues, file upload, SSRF, `ProblemDetails`, raw SQL, background jobs, multi-tenancy; untrusted text going to an LLM or prompt |
| `dotnet:observability` | `ILogger` calls or a new log line, metrics, tracing, `ActivitySource`, correlation ids, health checks, telemetry wiring |
| `dotnet:testing` | files under `*Tests*`, fixtures/test doubles, "add tests", Testcontainers, a bug or security fix that needs a regression test |

Typical bundles (the signals decide): new feature slice → ddd + web-api + validation + observability + testing; endpoint change → web-api + validation (+ testing); security fix → hardening + validation + testing; LLM call → hardening + validation + observability + testing; service bootstrap → web-api + hardening + observability + validation.

Re-route at these checkpoints: a new file type or layer enters the change; a log statement is added; a request type or user-supplied string appears; an outbound call (HTTP, LLM, queue) is added; the first test is written; and once more over the final diff before reporting done.

## Namespaces & file organization

- File-scoped namespaces; namespace mirrors folder structure.
- One type per file; a type used only inside one file may stay there.
- `GlobalUsings.cs` carries the cross-file usings.
- Service registration lives in `DependencyInjection.cs`, split into partials (`DependencyInjection.Database.cs`, `DependencyInjection.Observability.cs`) as it grows.

## Naming & layout (Microsoft framework style)

Match the dotnet/runtime, EF Core, and ASP.NET Core source conventions:

- Private instance fields `_camelCase`; static fields `s_`; thread-static fields `t_`.
- Write the visibility modifier first, even when it is the default (`private static`; `abstract`/`virtual` follow visibility).
- Language keywords over BCL names: `int`/`string`/`float`.
- `var` when the right-hand side states the type (`new`, cast, literal); spell the type out when the RHS is a method call with a non-obvious return type.
- `using` order: `System.*` first, then the rest, each group sorted.
- `sealed` by default; open a type for inheritance deliberately.
- `internal` for building-block types, exposed to tests with `[assembly: InternalsVisibleTo("…UnitTests")]`.

## Immutability & records

- Immutable by default; `record` over `class` for immutable types.
- Properties on the same line as the record declaration.
- Every `record <Name>` has a `<Name>Factory` static class in the **same file**, exposing `Create` (one factory per variant for unions/value objects). Argument validation lives in `Create`; callers construct through the factory.
- Collections inside records are immutable. `ImmutableArray<T>` is the default (built once, read afterward); `ImmutableList<T>` fits persistent snapshots that derive many incremental versions.
- Record behavior lives in extension methods in separate static classes, so records stay data.

## Discriminated unions

Abstract base record + sealed derived records, the whole union in one file, one static factories class per union with one factory method per variant. Record rules above apply.

## State as types

An entity with state-specific operations models state as types: payload → discriminated union; entity → abstract base + sealed per-state subtypes. Each operation exists only on the states where it is legal. Capability interfaces (`IApprovable`/`IRejectable`) mark transitions; `Try*` methods pattern-match and return a new immutable state. `_ => throw` arms cover genuinely impossible states; expected outcomes return a state. Full worked example: `references/state-as-types.md`.

## Value objects

Records, the whole value object in one file, one static factories class with one method per variant, inheriting `ValueObject` / `ValueObject<T>`. Base type, `Text` example, JSON and EF converters: `references/value-object-base.md`. Length-typed `Text` VOs for request DTOs live in `dotnet:validation`.

## Errors

`Result<T>` / `Option<T>` carry expected failures and optionals; exceptions signal programmer error and truly exceptional states. Library choice (YC.Monad first, else the codebase's existing monad) and usage: `references/monads.md`.

## Modern C#

- `<Nullable>enable</Nullable>` project-wide; `required` members express construction-time contracts.
- Collection expressions `[..]` for init and spread: `int[] ids = [..left, ..right, 0];`.
- Primary constructors on services, DI types, and records; explicit `_field` on mutable stateful classes where the captured parameter would mask a field.
- List/property patterns over index-and-length checks; `file`-local types for single-file helpers.
- `field` keyword (C# 14) for validated properties without a hand-declared backing field.
- `static` lambdas on hot paths; `params ReadOnlySpan<T>` for hot variadic APIs.

## Time

Inject `TimeProvider` and call `GetUtcNow()` / `GetTimestamp()` / `GetElapsedTime()` / `CreateTimer()`. Production binds `TimeProvider.System`; tests inject `FakeTimeProvider` and `Advance(...)` (see `dotnet:testing`). Code under test reads time and ids through injected abstractions (`TimeProvider`, an id factory).

```csharp
public sealed class Subscription(TimeProvider time)
{
    public bool IsExpired(DateTimeOffset until) => time.GetUtcNow() >= until;
}
builder.Services.AddSingleton(TimeProvider.System);
```

## Constants

- Compile-time values → `const`; otherwise `static readonly`. Every literal has a name.
- Cross-cutting names (HTTP headers, claim types, baggage/log keys, policy/queue/topic names, message headers) are defined once in a shared-kernel static class (`TelemetryConstants`, `MessageHeaders`) so producer, logs, and consumer agree.
- Options types carry their config path as `public const string SectionName`. Input size limits live in `InputLimits` (`dotnet:validation`).

## References — load when

| File | Load when |
|---|---|
| `references/linq.md` | aggregating, projecting, joining, or correlating collections; LINQ vs loop; ZLinq; `Single`/`ToDictionary`/`Join`/`Zip` pitfalls |
| `references/performance.md` | per-request/record/message paths; string building (ZString); pooled streams; closures and allocations; JSON source-gen / Native AOT |
| `references/async-concurrency.md` | async library code, `ConfigureAwait`, `ValueTask`, `CancellationToken`, `Parallel.ForEachAsync`, channels, `BackgroundService` |
| `references/composition.md` | options binding + validation, `AddX`/`UseX` extensions, keyed DI, guard clauses, library/NuGet surface, XML docs |
| `references/state-as-types.md` | modeling an entity that moves through states |
| `references/value-object-base.md` · `strongly-typed-ids-and-value-objects.md` | writing a value object or typed id; EF/JSON converters |
| `references/monads.md` | choosing or using `Result<T>` / `Option<T>` |
| `references/ef-core-data-access.md` | EF Core queries, paging, bulk work, value-object persistence |
| `references/mediator.md` | picking a mediator library, AutoMapper → Mapperly |
| `references/resilience.md` | outbound calls: Polly v8 pipelines, chaos testing |
| `references/caching.md` | application cache (hybrid L1/L2, FusionCache) |
| `references/input-limits.md` | the `InputLimits` constants class |

## Decision notes

- Between two readings of a rule, pick the one that keeps records immutable, business logic in the domain, and errors in `Result<T>`.
- A third-party library that forces a constructor or mutable state gets isolated behind a factory or wrapper so the domain stays clean.
- Optimization tricks belong on measured-hot paths; elsewhere readability wins.
