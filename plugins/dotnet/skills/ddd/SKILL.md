---
name: ddd
description: User's personal Domain-Driven Design & architecture rules for .NET — owns WHERE domain logic lives. Covers DDD tactical patterns (business logic in domain models, domain services, domain events, private-constructor + static-factory aggregates, value objects for primitives, discriminated unions for variants), the Modular Monolith layout (`BuildingBlocks/*`, `Modules/<Name>/{Application,Contracts,Domain,Infrastructure}`, `Presentation/*.Host`), and Vertical-Slice module structure. Use when modeling a domain, adding/changing an aggregate/entity/domain-event, scaffolding a new module or feature, or deciding project/layer layout. Use ALONGSIDE `csharp` (record/VO/monad idioms). NOT for request validation, JSON/serialization config, or endpoint wiring — those are `web-api` / `validation`.
---

# .NET Domain-Driven Design & Architecture

Owns **where domain logic lives** and how the solution is structured. Record/value-object/discriminated-union *language patterns* come from `csharp`; this skill governs domain modeling and module layout. Apply alongside `csharp`.

## Domain Driven Design

- Apply DDD principles. Business logic lives in domain models. Add domain services in the domain layer when needed.
- Pass services into domain methods as parameters when needed — only for operations without side effects.
- Use **Domain Events** for cross-cutting concerns.
- Domain models: **private constructor + static factory methods**. Never construct directly when a factory exists.
- Validation goes in the factory method. Return a monad type (`Result<T>` / `Option<T>` — from YC.Monad if available, otherwise the codebase's existing equivalent) when validation can fail. See `../index/references/monads.md`.
- Use **value objects** for complex primitives. Base type: `../index/references/value-object-base.md`.
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
  - `GoActivity.<ModuleName>.Application` — Features, Commands, Queries, Handlers.
  - `GoActivity.<ModuleName>.Contracts` — Public interfaces + DTOs for cross-module use.
  - `GoActivity.<ModuleName>.Domain` — domain models, aggregates, business rules.
  - `GoActivity.<ModuleName>.Infrastructure` — module-specific persistence and impl.
- `Presentation/GoActivity.Host` — ASP.NET Core Web API entrypoint, bootstraps all modules.
- `GoActivity.slnx` — solution file.

If the existing project uses a different architecture, **follow that architecture** and record the deviation so it stays consistent across the session.

## Vertical Slice Architecture (inside Application)

- Organize by business capability under `Features/`.
- Structure: `Features/<FeatureName>/<Scope>/<Commands|Queries>/`.
- Example: `Features/VendorActivities/Backoffice/Commands/CreateActivityCommand.cs`.
- One slice file holds Command/Query + Handler + slice-specific DTOs/Validators.

The concrete slice skeleton (Endpoint/Request/Validator/Handler/Response) and FluentValidation conventions live in `web-api` — this skill only fixes *where* slices sit in the module layout.

## Strongly-typed IDs

An entity id is never a raw `Guid`/`int` (prevents `customerId == orderId` mixing at compile time).
Two acceptable forms:

- A `ValueObject<T>` id (see `csharp`) when you want the id to share the VO base and factory rules.
- **Vogen** (`[ValueObject<Guid>]` source generator) when you want the boilerplate (equality,
  validation, EF + JSON converters) generated. Seed ids with `Guid.CreateVersion7()` (see `csharp`).

```csharp
[ValueObject<Guid>]
public readonly partial struct OrderId
{
    private static Validation Validate(Guid v) => v != Guid.Empty ? Validation.Ok : Validation.Invalid("empty id");
}
```

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

## Related skills

- `csharp` — record/VO/DU/monad language patterns used by domain models.
- `web-api` — slice skeleton, handlers, endpoints.
- `validation` — request DTO limits and validators.
- `hardening` — multi-tenancy, outbox, EF hardening for the infra layer.
- `testing` — architecture tests enforce these layer boundaries; unit tests for domain factories.
