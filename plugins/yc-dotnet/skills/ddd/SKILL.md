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

## Related skills

- `csharp` — record/VO/DU/monad language patterns used by domain models.
- `web-api` — slice skeleton, handlers, endpoints.
- `validation` — request DTO limits and validators.
- `hardening` — multi-tenancy, outbox, EF hardening for the infra layer.
- `testing` — architecture tests enforce these layer boundaries; unit tests for domain factories.
