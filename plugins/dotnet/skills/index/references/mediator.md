# Mediator selection & licensing (single source of truth)

> Requires .NET 8+. Owns the **which-mediator** decision for `web-api` and `validation`.

MediatR, AutoMapper, and MassTransit moved to **commercial/paid licensing** (MediatR v13+,
AutoMapper v15+, MassTransit v9+, during 2024–2025; free only under a revenue threshold). The skills
no longer assume MediatR is free. Pick the mediator **before scaffolding a handler**:

## Decision rule

1. Inspect the project's package references.
2. **`Mediator` (`martinothamar/Mediator`)** present → **preferred**. Source-generated, Apache-2.0, no
   per-seat cost, near drop-in API.
3. **`MediatR` ≤ v12** present → acceptable (still free); keep existing patterns.
4. **`MediatR` ≥ v13** present → **licensed**. Confirm the team holds a license; otherwise propose
   migrating to `Mediator`.
5. **No mediator package** present → **ASK THE USER which to install** (`Mediator` recommended) before
   writing the slice. Do not silently add a licensed package.

## API parity (why the swap is cheap)

The handler/behavior contracts are the same shape, so the slice skeleton (`web-api`) and
`ValidationBehavior<,>` (`validation`) are reused verbatim:

```csharp
public sealed record CreateActivity(...) : IRequest<Result<ActivityId>>;
public sealed class Handler : IRequestHandler<CreateActivity, Result<ActivityId>> { /* ... */ }
public sealed class ValidationBehavior<TReq, TRes> : IPipelineBehavior<TReq, TRes> { /* ... */ }
```

Registration differs:

```csharp
// martinothamar/Mediator (source-gen) — preferred
builder.Services.AddMediator(o => o.ServiceLifetime = ServiceLifetime.Scoped);

// MediatR (≤ v12, free) — acceptable
builder.Services.AddMediatR(c => c.RegisterServicesFromAssembly(typeof(Program).Assembly));
```

Open-behavior registration (`AddOpenBehavior(typeof(ValidationBehavior<,>))`) exists in both.

## Object mapping — no reflection mappers

AutoMapper is commercial **and** reflection-based. Use **`riok/Mapperly`** (source-gen, free,
zero-alloc, compile-time-checked) or hand-written mapping. Never add reflection AutoMapper to new code.

```csharp
[Mapper]
public partial class ActivityMapper
{
    public partial ActivityResponse ToResponse(Activity activity); // generated at build time
}
```

## Unified alternative — Wolverine

For greenfield services that want **mediator + messaging + outbox in one** free (Apache-2.0,
source-gen) package, **JasperFx/Wolverine** replaces MediatR **and** MassTransit. Handlers are plain
methods; `IMessageBus.PublishAsync` carries the durable outbox. Consider it when the licensing of both
MediatR and MassTransit is in play; otherwise the `Mediator` + existing outbox guidance is sufficient.
