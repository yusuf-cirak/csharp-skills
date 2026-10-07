---
name: ddd
description: Use when modeling a .NET domain, adding or changing an aggregate/entity/domain-event, scaffolding a new module or feature, or deciding project/layer layout. NOT for request validation, JSON/serialization config, or endpoint wiring — see `web-api` / `validation`.
---

# .NET Domain-Driven Design & Architecture

Owns **where domain logic lives** and how the solution is structured: DDD tactical patterns (business logic in domain models, domain services, domain events, private-constructor + static-factory aggregates, value objects for primitives, discriminated unions for variants), the Modular Monolith layout (`BuildingBlocks/*`, `Modules/<Name>/{Application,Contracts,Domain,Infrastructure}`, `Presentation/*.Host`), and Vertical-Slice module structure. Record/value-object/discriminated-union *language patterns* come from `csharp`; this skill governs domain modeling and module layout. Apply alongside `csharp`.

## Domain Driven Design

- Apply DDD principles. Business logic lives in domain models. Add domain services in the domain layer when needed.
- Pass services into domain methods as parameters when needed — only for operations without side effects.
- Use **Domain Events** for cross-cutting concerns.
- Domain models: **private constructor + static factory methods**. Never construct directly when a factory exists.
- Validation goes in the factory method. Return a monad type (`Result<T>` / `Option<T>` — from YC.Monad if available, otherwise the codebase's existing equivalent) when validation can fail. See `../index/references/monads.md`.
- Use **value objects** for complex primitives. Hand-rolled base: `../index/references/value-object-base.md`; source-generated (Vogen `[ValueObject<string>]`, `NormalizeInput`/`Validate`/`[GeneratedRegex]`): `../index/references/strongly-typed-ids-and-value-objects.md`.
- Use **discriminated unions** for types with multiple variants.
- Model aggregate/entity **state machines as types**, not boolean flags or a status enum: sealed
  per-state subtypes that expose only their legal operations, a DU for the state payload, capability
  interfaces, and `Try*` pattern-matched transitions. Persistence keeps the rich domain model separate
  from the flat DB shape (or stores polymorphic JSON). Full pattern: `../index/references/state-as-types.md`.

## Modular Monolith Architecture

Default layout:

- `BuildingBlocks/`
  - `BuildingBlocks.Application` — MediatR behaviors, base abstractions, monads.
  - `BuildingBlocks.Domain` — Entity, AggregateRoot, DomainEvent.
  - `BuildingBlocks.Host` — middleware, Swagger/Scalar, host defaults.
  - `BuildingBlocks.Infrastructure` — Persistence base, Outbox, shared infra.
- `Modules/<ModuleName>/`
  - `<Solution>.<ModuleName>.Application` — Features, Commands, Queries, Handlers.
  - `<Solution>.<ModuleName>.Contracts` — Public interfaces + DTOs for cross-module use.
  - `<Solution>.<ModuleName>.Domain` — domain models, aggregates, business rules.
  - `<Solution>.<ModuleName>.Infrastructure` — module-specific persistence and impl.
- `Presentation/<Solution>.Host` — ASP.NET Core Web API entrypoint, bootstraps all modules.
- `<Solution>.slnx` — solution file.

If the existing project uses a different architecture, **follow that architecture** and record the deviation so it stays consistent across the session.

## Vertical Slice Architecture (inside Application)

- Organize by business capability under `Features/`.
- Structure: `Features/<FeatureName>/<Scope>/<Commands|Queries>/`.
- Example: `Features/VendorActivities/Backoffice/Commands/CreateActivityCommand.cs`.
- One slice file holds Command/Query + Handler + slice-specific DTOs/Validators.

The concrete slice skeleton (Endpoint/Request/Validator/Handler/Response) and FluentValidation conventions live in `web-api` — this skill only fixes *where* slices sit in the module layout.

## Strongly-typed IDs

An entity id is never a raw `Guid`/`int` (prevents `customerId == orderId` mixing at compile time).
Two acceptable forms: a `ValueObject<T>` id (see `value-object-base.md`) when it should share the VO
base + factory rules, or a **Vogen** `[ValueObject<Guid>]` when you want equality/validation/converters
generated. Full Vogen depth (int reference-data ids, converter registration, `IParsable`, packaging,
`TryFrom` vs `Result`): `../index/references/strongly-typed-ids-and-value-objects.md`.

## Persisting domain types (EF Core)

Value objects and strongly-typed ids map to the DB without leaking persistence into the domain:

- **Complex types** (`ComplexProperty`, EF/.NET 8) for multi-field VOs that share the owner's table.
- **Value converters** (`HasConversion`, EF 5+) for single-value VOs / ids — Vogen ships one.

Full idioms + query-perf rules: `../index/references/ef-core-data-access.md`.

## Domain-event dispatch (concrete)

Aggregates raise events into an internal list; **a `SaveChangesInterceptor` dispatches them in the same
transaction** — not a hand-called publish the developer can forget. For cross-process delivery, the
interceptor writes **outbox rows** (never dual-write to a broker; see `hardening` → Background Jobs),
relayed by a `BackgroundService` (see `csharp` → Channels / hosted services).

```csharp
public sealed class DomainEventInterceptor(IPublisher publisher) : SaveChangesInterceptor
{
    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData e, InterceptionResult<int> r, CancellationToken ct = default)
    {
        var events = e.Context!.ChangeTracker.Entries<AggregateRoot>()
            .SelectMany(x => x.Entity.DrainDomainEvents()).ToArray();
        foreach (var ev in events) await publisher.Publish(ev, ct); // or enqueue to outbox
        return await base.SavingChangesAsync(e, r, ct);
    }
}
```

> Bulk `ExecuteUpdate`/`ExecuteDelete` bypasses the change tracker, so it does **not** raise domain
> events — use it only for maintenance paths, never to mutate event-raising aggregates.

**Pre/Post split.** `IPreDomainEvent : IDomainEvent` is published inside `SavingChangesAsync` (SAME
transaction, before commit — invariants / derived writes that must persist atomically); `IPostDomainEvent`
is published in `SavedChangesAsync` (AFTER commit — side-effects: notifications, integration/outbox
events). One interceptor drains the aggregate's events and splits by marker.

## Placement & naming of reusable capabilities

- **Reusable capability → the shared library, behind a surface parallel to the existing ones.** If the library
  already exposes `service.Document.AnalyzeAsync`, a new capability is `service.Decision.DecideAsync` — not a
  module-local service that re-implements provider selection, fallbacks, retries or caching. Building on the
  existing pipeline makes every cross-cutting behavior apply for free.
- **The module keeps only what is specific to it**: the policy text/rules, orchestration, usage/audit recording,
  and mapping the result to the module's own failures. If a class would work unchanged in another module, it
  belongs in the library.
- **Module-specific helpers carry the module prefix even when they live in a shared project** (`ExpensePromptBlock`,
  `ExpenseOcrLimits`), so a generic-looking name never implies reuse that was not designed.
- **Fail-closed gates sit at the write boundary** (the command that persists the setting), not deep inside the
  consumer — reject before bad data can be stored or served.

## Related skills

- `csharp` — record/VO/DU/monad language patterns used by domain models.
- `web-api` — slice skeleton, handlers, endpoints.
- `validation` — request DTO limits and validators.
- `hardening` — multi-tenancy, outbox, EF hardening for the infra layer.
- `testing` — architecture tests enforce these layer boundaries; unit tests for domain factories.
