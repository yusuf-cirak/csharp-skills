---
name: index
description: Use at the start of, and at every change of shape during, any C# / .NET / ASP.NET Core work (`.cs`/`.csproj`/`.slnx`/`.razor`/`.cshtml`/`Directory.Build.props`/`global.json`) or when the user references "the coding standards" generically — even if the standards aren't mentioned by name.
---

# C# / .NET Standards — Router (dotnet:index)

The user's permanent C# rules, split into seven focused sub-skills so concerns stop bleeding into each other (`csharp`, `ddd`, `web-api`, `validation`, `hardening`, `observability`, `testing`). **This file holds no rules — it routes.** Read the signals below and invoke EVERY sub-skill the work matches — at the start and again at each checkpoint. `csharp` is the always-on base layer; layer the others on top as needed.

## How to use this router

Decide from the **work itself**, not from a guess about the task title. Before the first edit and again whenever the
work changes shape, read the signals below and load every sub-skill whose signal is present. Loading is cheap; a
rule you never loaded is a rule you silently break (skill text is not injected later — only what you invoke is in
context).

1. **Collect signals** from three places: what you are about to **touch** (paths, namespaces, project files), what
   you are about to **write** (constructs), and what the **user's words** ask for.
2. **Invoke every matched sub-skill** via the Skill tool (`dotnet:<short>`). Combinations are the norm. Always invoke
   `dotnet:csharp` for any `.cs` edit.
3. **When unsure whether a signal applies, load the skill** — the cost of an unused skill is far lower than a
   violated rule.
4. **Re-route at these checkpoints** (do not wait to be reminded): a new file type or layer enters the change;
   a log statement is added; a request/command/query or any user-supplied string appears; an outbound call
   (HTTP, LLM, queue) is added; the first test is written; and once more over the final diff before reporting done.

## Signals — what the work looks like → skill

| Skill | Load when you see… |
|---|---|
| **`dotnet:csharp`** (always) | any `.cs`/`.csproj`/`Directory.Packages.props` edit; records, value objects, DUs, `Result<T>`/`Option<T>`, LINQ, async/`CancellationToken`, `Span`, `TimeProvider`, DI registration, constants, options classes, source-gen JSON/logging |
| **`dotnet:ddd`** | entities, aggregates, domain events, value objects, strongly-typed ids; files under `Domain/`, `Modules/<X>/`, `BuildingBlocks/`; "module", "layer", "bounded context"; EF mapping of domain types; deciding **where** new code lives or how a module-specific helper is named |
| **`dotnet:web-api`** | `Controllers/`, `Endpoints/`, `[Http*]`, `MapGet/MapPost`, `IRequestHandler`/`ISender`/mediator, slice files, `Program.cs` middleware order, pagination shape |
| **`dotnet:validation`** | any request DTO/command/query; **any free-text field, string or file that comes from a caller**; `AbstractValidator`; length/size/depth limits; `Regex`; `JsonSerializerOptions`/Kestrel/`FormOptions`; output encoding |
| **`dotnet:hardening`** | auth/authz, secrets, rate limiting, idempotency, caching, outbound HTTP/queues, file upload, SSRF, error shape/`ProblemDetails`, raw SQL, background jobs, multi-tenancy; **anything that sends untrusted text to an LLM, builds a prompt, or gates input with a model** (see "LLM / Prompt-Injection Hardening") |
| **`dotnet:observability`** | `ILogger` calls or any new log line, metrics, tracing, `ActivitySource`, correlation ids, health checks, telemetry wiring, "logging" in the user's words |
| **`dotnet:testing`** | any file under `*Tests*`, fixtures/test doubles, "write/add tests", integration/Testcontainers, a bug fix or security fix that needs a regression test, real-provider/LLM checks |

Typical combinations (still read the signals — they override this list):

- **New feature slice end-to-end** → `csharp` + `ddd` + `web-api` + `validation` + `observability` + `testing`.
- **Domain model only** → `csharp` + `ddd` (+ `testing`).
- **Endpoint/handler change** → `csharp` + `web-api` + `validation` (+ `observability`, `testing`).
- **Security review / fix** → `hardening` + `validation` + `testing` (+ `observability` for the audit trail).
- **Anything with an LLM call or prompt** → `csharp` + `hardening` + `validation` + `observability` + `testing` (+ `ddd` for where the capability lives).
- **New service bootstrap / `Program.cs`** → `web-api` + `hardening` + `observability` + `validation` (+ `csharp`).
- **Test project / fixtures** → `testing` + `csharp`.

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
- `references/caching.md` — hybrid L1/L2 application cache (FusionCache): stampede protection, fail-safe, backplane invalidation.
