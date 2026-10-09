---
name: ddd
description: Guides .NET domain modeling and solution layout. Use when modeling a domain, adding or changing an aggregate/entity/domain-event, scaffolding a new module or feature, or deciding project/layer layout. Request validation and JSON config live in `validation`; endpoint wiring in `web-api`.
---

# .NET Domain-Driven Design & Architecture

## Contents

- Domain Driven Design → `../csharp/references/monads.md`, `../csharp/references/value-object-base.md`, `../csharp/references/strongly-typed-ids-and-value-objects.md`, `../csharp/references/state-as-types.md`
- Modular Monolith Architecture
- Vertical Slice Architecture (inside Application) → `dotnet:web-api`
- Strongly-typed IDs → `../csharp/references/strongly-typed-ids-and-value-objects.md`
- Persisting domain types (EF Core) → `../csharp/references/ef-core-data-access.md`
- Domain-event dispatch (concrete) → `dotnet:hardening`, `dotnet:csharp`
- Placement & naming of reusable capabilities
- Related skills → `dotnet:csharp`, `dotnet:web-api`, `dotnet:validation`, `dotnet:hardening`, `dotnet:testing`

## Files

- `../csharp/references/monads.md` — Monadic error handling — library selection & usage
- `../csharp/references/value-object-base.md` — Value Object base type + converters
- `../csharp/references/strongly-typed-ids-and-value-objects.md` — Strongly-typed IDs & value objects (Vogen)
- `../csharp/references/state-as-types.md` — State as types — polymorphic state machines (no boolean flags)
- `../csharp/references/ef-core-data-access.md` — EF Core data access — performance & value-object persistence (single source of truth)
- `dotnet:web-api` (`../web-api/SKILL.md`) — ASP.NET Core Web API
- `dotnet:hardening` (`../hardening/SKILL.md`) — Production Hardening (FAANG-level)
- `dotnet:csharp` (`../csharp/SKILL.md`) — C# House Style
- `dotnet:validation` (`../validation/SKILL.md`) — ASP.NET Core Input Security & Serialization Limits
- `dotnet:testing` (`../testing/SKILL.md`) — C# Testing Standard

Owns **where domain logic lives** and how the solution is structured: DDD tactical patterns (business logic in domain models, domain services, domain events, private-constructor + static-factory aggregates, value objects for primitives, discriminated unions for variants), the Modular Monolith layout (`BuildingBlocks/*`, `Modules/<Name>/{Application,Contracts,Domain,Infrastructure}`, `Presentation/*.Host`), and Vertical-Slice module structure. Record/value-object/discriminated-union *language patterns* come from `csharp`; this skill governs domain modeling and module layout. Apply alongside `csharp`.

## Domain Driven Design

- Apply DDD principles. Business logic lives in domain models. Add domain services in the domain layer when needed.
- Pass services into domain methods as parameters when needed — only for operations without side effects.
- Use **Domain Events** for cross-cutting concerns.
- Domain models: **private constructor + static factory methods**. Never construct directly when a factory exists.
- Validation goes in the factory method. Return a monad type (`Result<T>` / `Option<T>` — from YC.Monad if available, otherwise the codebase's existing equivalent) when validation can fail. See `../csharp/references/monads.md`.
- Use **value objects** for complex primitives. Hand-rolled base: `../csharp/references/value-object-base.md`; source-generated (Vogen `[ValueObject<string>]`, `NormalizeInput`/`Validate`/`[GeneratedRegex]`): `../csharp/references/strongly-typed-ids-and-value-objects.md`.
- Use **discriminated unions** for types with multiple variants.
- Model aggregate/entity **state machines as types**, not boolean flags or a status enum: sealed
  per-state subtypes that expose only their legal operations, a DU for the state payload, capability
  interfaces, and `Try*` pattern-matched transitions. Pick the stored shape (flat record, TPH, or
  polymorphic JSON) from the domain and the DB technology; callers use one `WriteTo`-style method and
  the state decides whether it writes or no-ops. Full pattern: `../csharp/references/state-as-types.md`.

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
`TryFrom` vs `Result`): `../csharp/references/strongly-typed-ids-and-value-objects.md`.

## Persisting domain types (EF Core)

Value objects and strongly-typed ids map to the DB without leaking persistence into the domain:

- **Complex types** (`ComplexProperty`, EF/.NET 8) for multi-field VOs that share the owner's table.
- **Value converters** (`HasConversion`, EF 5+) for single-value VOs / ids — Vogen ships one.

Full idioms + query-perf rules: `../csharp/references/ef-core-data-access.md`.

## Domain-event dispatch (concrete)

Aggregates raise events into an internal list; **a `SaveChangesInterceptor` dispatches them in the same
transaction** — not a hand-called publish the developer can forget. For cross-process delivery, the
outbox rows are written by an **event handler** (never dual-write to a broker; see `hardening` → Background Jobs),
relayed by a `BackgroundService` (see `csharp` → Channels / hosted services).

**The developer's whole job is one call:** raise the event in the domain (`Raise(new OrderPaid(...))`) and
save the aggregate. Nobody (not the repository, not the command handler) adds outbox rows by hand. A
pre-commit handler per integration event does it, inside the same transaction as the state change:

```csharp
public sealed class OrderPaidOutbox(AppDbContext db, TimeProvider time) : INotificationHandler<OrderPaid>
{
    public ValueTask Handle(OrderPaid e, CancellationToken ct)
    {
        db.OutboxMessages.Add(OutboxMessage.From(e, time.GetUtcNow()));   // same DbContext, same SaveChanges
        return ValueTask.CompletedTask;
    }
}
```

Adding a new cross-process event = one event record + one such handler; no call site changes. The event
must be handled **pre-commit** (`IPreDomainEvent`) so the row commits atomically with the state.

**Two-model persistence** (flat row, aggregate not tracked; `state-as-types.md` §5a): the tracker holds
the row, not the `AggregateRoot`, so the interceptor below finds nothing. Have the repository hand the
drained events to a scoped `DomainEventCollector` and let the same interceptor dispatch from it:

```csharp
public sealed class DomainEventCollector
{
    private readonly List<IDomainEvent> _events = [];
    public void Add(IEnumerable<IDomainEvent> events) => _events.AddRange(events);
    public IDomainEvent[] Drain() { var e = _events.ToArray(); _events.Clear(); return e; }
}
// repository: order.WriteTo(record); collector.Add(order.DrainDomainEvents()); await db.SaveChangesAsync(ct);
// interceptor: var events = tracked-aggregate events.Concat(collector.Drain())
```

```csharp
public sealed class DomainEventInterceptor(IPublisher publisher) : SaveChangesInterceptor
{
    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData e, InterceptionResult<int> r, CancellationToken ct = default)
    {
        var events = e.Context!.ChangeTracker.Entries<AggregateRoot>()
            .SelectMany(x => x.Entity.DrainDomainEvents()).ToArray();
        foreach (var ev in events) await publisher.Publish(ev, ct); // outbox handlers add their rows here
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

- `dotnet:csharp` — record/VO/DU/monad language patterns used by domain models.
- `dotnet:web-api` — slice skeleton, handlers, endpoints.
- `dotnet:validation` — request DTO limits and validators.
- `dotnet:hardening` — multi-tenancy, outbox, EF hardening for the infra layer.
- `dotnet:testing` — architecture tests enforce these layer boundaries; unit tests for domain factories.
