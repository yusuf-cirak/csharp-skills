---
name: csharp
description: User's personal C# language & style idioms — the always-on base layer for ANY `.cs` work. Covers file-scoped namespaces and file organization, immutability, strict record design with `<Name>Factory` static classes, discriminated unions, polymorphic state machines (state-as-types over boolean flags), value objects (base type + pattern), YC.Monad `Result<T>`/`Option<T>` error handling, LINQ-over-imperative-loops, `Span<T>`/`IEnumerable<T>` performance rules, and Microsoft framework-author conventions (field/visibility naming, library async discipline with `ConfigureAwait(false)`/`ValueTask`/`CancellationToken`, hot-path perf primitives, framework/DI surface, XML docs). MUST be used whenever writing, editing, reviewing, or generating ANY C# code (`.cs`/`.csproj`/`.slnx`) or discussing C#/.NET language features — even if unmentioned. This is the foundation; for domain modeling also use `ddd`, for endpoints `web-api`, for request/DTO limits `validation`, for service hardening `hardening`.
---

# C# Language & Style

The user's permanent C# language idioms. Apply by default to any `.cs` edit. If a framework or language version makes a rule impossible, write the closest equivalent and note why. This is the base layer every other C# skill (`ddd`, `web-api`, `validation`, `hardening`) builds on.

## Namespaces & File Organization

- File-scoped namespaces. Namespace mirrors folder structure.
- One type per file. Exception: a type used only within a single file may stay in that file.
- Use `GlobalUsings.cs` to keep files clean.
- Register services in `DependencyInjection.cs`. Split into partials like `DependencyInjection.Database.cs`, `DependencyInjection.Observability.cs` to keep registration readable.

## Naming & layout (Microsoft framework style)

Match the dotnet/runtime / EF Core / ASP.NET Core source conventions for the mechanical bits:

- Private instance fields: `_camelCase` (`private readonly ISqlExpressionFactory _sqlFactory;`).
- Static fields: `s_` prefix; thread-static fields: `t_` prefix.
- Always write the visibility modifier, first, even when it is the default `private`
  (`private static`, not `static`; `abstract`/`virtual` come after visibility).
- Language keywords over BCL type names: `int`/`string`/`float`, never `Int32`/`String`/`Single`.
- `var` only when the type is explicit on the right-hand side (a `new`, cast, or literal); spell the
  type out when the RHS is a method call whose return type isn't obvious.
- `using` order: `System.*` first, then everything else, each group sorted (`GlobalUsings.cs` still
  carries the cross-file set).

## Immutability

- Prefer immutable types unless mutability is explicitly requested.
- Prefer `record` over `class` for immutable types.

## Record Design (strict)

- Properties on the same line as the record declaration.
- Each `record <Name>` is accompanied by a `<Name>Factory` static class in the **same file**.
- Factory exposes a static `Create` method (or one factory per variant for unions/value objects).
- Argument validation lives in `Create`.
- Never call the record constructor when a factory exists.
- Use immutable collections inside records. Prefer `ImmutableList<T>`.
- Define record behavior as **extension methods** in separate static classes — keep records as data.

## Discriminated Unions

- Use records. Abstract base record + sealed derived records.
- Entire union lives in one file.
- One static factories class per union, one factory method per variant.
- All record-design rules above still apply.

## State as types (no boolean flags)

When an entity moves through a finite set of states with **state-specific operations**, model the
state as types, not `bool` flags or a status enum guarded by `if`-`else`. Make illegal states
unrepresentable:

- State payload → a **discriminated union**; entity → an abstract base + sealed per-state subtypes.
- Expose an operation **only on the states where it is legal** (e.g. `Execute` lives only on the
  approved subtype — no runtime "is it approved?" check).
- Mark transition capabilities with **interfaces** (`IApprovable`/`IRejectable`); drive transitions
  with `Try*` methods that **pattern-match** and return a new immutable state — never `if`-`else`,
  never mutate.
- Guard subtype construction so a subtype can only wrap its allowed states (`Assert<T1,T2>()`).
- `_ => throw` arms are for genuinely-impossible states only; expected outcomes return a state.

Full worked example (four-eyes `Transfer`), plus relational two-model persistence and document-store
polymorphic JSON, in the shared reference:

→ `../index/references/state-as-types.md`

## Value Objects

- Use records. Entire value object in one file.
- One static factories class per value object, one factory method per variant.
- Inherit from base `ValueObject` / `ValueObject<T>`.

Base type, `Text` example, JSON converter, and EF Core converter live in the shared reference (single source of truth):

→ `../index/references/value-object-base.md`

For length-typed `Text` VOs used on request DTOs (`ShortText`/`MediumText`/…), see `validation`.

## Functional + OO

Monadic error handling (`Result<T>`/`Option<T>`) over exceptions, monadic optionals over nullable references. Library selection (YC.Monad first, else the codebase's existing monad) and usage rules live in the shared reference:

→ `../index/references/monads.md`

## LINQ over imperative loops

- When aggregating, projecting, flattening, joining, or correlating collections, prefer LINQ over a `foreach` + manual accumulator.
- Prefer `Select`, `SelectMany`, `Where`, `Join`, `GroupBy`, `GroupJoin`, `Zip`, `Aggregate`, `ToDictionary`, `ToLookup` — they make intent explicit and compose.
- Reach for `foreach` only when the body has side effects (I/O, mutation of external state, logging, `await` per item without `await foreach`), or when LINQ would force materialization that hurts performance.
- Keep LINQ pipelines pure; do not mutate captured state inside `Select`/`Where`.
- Combine with `IEnumerable<T>` / `IAsyncEnumerable<T>` from the Performance rules — do not materialize with `ToList()` unless a caller needs random access or multiple enumerations.

Example — aggregating order totals per customer with line items from a separate source:

```csharp
public static class OrderSummaryAggregator
{
    public static ImmutableList<CustomerOrderSummary> Aggregate(
        IEnumerable<Customer> customers,
        IEnumerable<Order> orders,
        IEnumerable<OrderLine> lines)
        => customers
            .GroupJoin(
                orders,
                customer => customer.Id,
                order => order.CustomerId,
                (customer, customerOrders) => (customer, customerOrders))
            .Select(pair => pair.customerOrders
                .Join(
                    lines,
                    order => order.Id,
                    line => line.OrderId,
                    (order, line) => (order, line))
                .GroupBy(x => x.order.Id)
                .Select(orderGroup => new OrderTotal(
                    OrderId: orderGroup.Key,
                    Total: orderGroup.Sum(x => x.line.Quantity * x.line.UnitPrice)))
                .Pipe(orderTotals => CustomerOrderSummaryFactory.Create(
                    customer: pair.customer,
                    orderTotals: orderTotals.ToImmutableList())))
            .ToImmutableList();
}
```

Counter-example — what NOT to do:

```csharp
// Avoid: imperative accumulation hides the shape of the transformation.
var summaries = new List<CustomerOrderSummary>();
foreach (var customer in customers)
{
    decimal total = 0m;
    foreach (var order in orders)
    {
        if (order.CustomerId != customer.Id) continue;
        foreach (var line in lines)
        {
            if (line.OrderId == order.Id)
                total += line.Quantity * line.UnitPrice;
        }
    }
    summaries.Add(new CustomerOrderSummary(customer.Id, total));
}
```

## Performance

- Prefer `Span<T>` / `ReadOnlySpan<T>` over `string` / `ReadOnlyMemory<T>` when possible.
- Prefer `IEnumerable<T>` over `List<T>` when callers only enumerate.
- Prefer arrays over `List<T>` for fixed-size collections.
- Use `IAsyncEnumerable<T>` for async streams instead of materialized lists.
- Prefer singleton lifetime over scoped when state allows.
- **`FrozenSet<T>` / `FrozenDictionary<K,V>`** for static, read-mostly lookup sets built once at startup (sensitive-key sets, scope tables, allow-lists) — faster reads than `HashSet`/`Dictionary`.
- **Time-ordered ids**: `Guid.CreateVersion7()` (UUIDv7) for entity/message/correlation ids — index-friendly (monotonic) unlike random v4.

### Hot-path allocation discipline

On per-request / per-record / per-message paths (middleware, log/OTel processors, serializers), allocation is the cost — be deliberate:

- Allocate **nothing** when there's nothing to do (early-return before building a list); build **one pre-sized** collection when you must.
- Prefer **struct enumerators** and indexer loops over LINQ; LINQ materialization and iterator objects are real allocations here.
- Read a **known key set directly** (e.g. `Activity.GetBaggageItem(key)`) instead of enumerating a collection whose getter allocates an iterator (`Activity.Baggage`).
- **Cache** reflection results, compiled delegates, and converted strings; use `ReferenceEquals` fast-paths when an unchanged value is cached as the same instance.
- **Microsoft-style primitives** for these paths: `ArrayPool<T>.Shared.Rent(n)` for transient buffers, returned in `finally`; `stackalloc` for small buffers under a ~256-byte ceiling with a heap fallback (`Span<char> b = len <= 256 ? stackalloc char[len] : new char[len];`); `StringBuilder` when concatenating in a loop (never `+=` a string per iteration); `[MethodImpl(MethodImplOptions.AggressiveInlining)]` only on a proven-hot tiny method, with a one-line comment saying why.
- **Provider query translators are the canonical LINQ-violation site** — the no-LINQ/no-closures rule above applies hardest there.
- **`readonly struct` escape hatch**: a value object **proven** (benchmark in hand) to allocate on a hot per-row path may become a `readonly struct` instead of a `record` — still immutable, still factory-constructed, kept out of the domain layer. Default stays `record`.
- Keep these tricks **out of cold paths** — readability wins everywhere that isn't measured-hot.

## Async (library code, Microsoft-style)

Library/framework code runs under callers we don't control — follow the dotnet/runtime + EF Core rules:

- `ConfigureAwait(false)` on **every** `await` in library/framework code. Drop it only in app-level
  ASP.NET request or UI code where the synchronization context is wanted.
- Return `ValueTask`/`ValueTask<T>` when the method frequently completes synchronously (cache hits,
  fast-path lookups) — avoids a per-call `Task` allocation. Use `Task` when it almost always awaits.
- Thread `CancellationToken` through to every downstream async call; default it as the last public
  parameter (`CancellationToken cancellationToken = default`).
- No `async void` except event handlers — an unobserved exception there crashes the process.

## Constants & cross-cutting names

- **No magic strings or numbers.** Compile-time → `const`; non-compile-time → `static readonly`. (Input size/length limits live in `InputLimits` — see `validation`.)
- **Cross-cutting names get a single source of truth.** HTTP header names, claim types, baggage/log attribute keys, policy names, queue/topic names, message-header names — define them **once** in a shared-kernel static class (e.g. `TelemetryConstants`, `MessageHeaders`) so the producer, the logs, and the consumer all agree. Duplicated literals that must match across layers are a defect.
- Options types carry their config path as a `public const string SectionName`.

## Options pattern (fail-fast)

Bind configuration to a typed options class and **validate at startup** — a misconfigured deployment crashes on boot with a clear message, not at the first request.

```csharp
services.AddOptions<JwtOptions>()
    .BindConfiguration(JwtOptions.SectionName)
    .ValidateDataAnnotations()
    .Validate(o => o.Mode != JwtMode.Symmetric || !string.IsNullOrWhiteSpace(o.SigningKey),
              "SigningKey required when Mode=Symmetric") // cross-field rules
    .ValidateOnStart();
```

Options classes are sealed, immutable where possible, and annotated (`[Required]`, `[Range]`). Read raw `IConfiguration` only at composition time.

## Cross-cutting via extension members

- One cross-cutting concern per file, exposed as an `AddX(this WebApplicationBuilder)` / `UseX(this WebApplication)` pair, so `Program.cs` stays a thin, readable list of capabilities.
- Use C# **extension members** (`extension(IServiceCollection services) { public IServiceCollection AddX() {…} }`) to group related extensions cleanly.
- **Endpoint opt-in conventions**: a marker metadata type + a `.RequireX()` extension on `IEndpointConventionBuilder` + a `context.GetEndpoint()?.Metadata.GetMetadata<T>()` read in the middleware (e.g. `.RequireIdempotency()`, `.RequireScope("…")`, `.SuppressLogging()`). Declarative at the route, enforced in one middleware.

### Framework / library surface (Microsoft-style)

When authoring a library, NuGet package, or EF Core provider/extension:

- Public DI registration extensions and fluent builders **return the builder/`IServiceCollection`** so
  calls chain; provider option methods return the same `DbContextOptionsBuilder`.
- Bundle a service's injected dependencies in a **`sealed record` with `required init` properties**
  (the EF Core `XxxDependencies` pattern) — immutable, `with`-copyable, one constructor parameter
  instead of ten. Consistent with records-everywhere.
- Offer **generic + non-generic overloads** where a caller may hold only a `Type`
  (`Set<TEntity>()` and `Set(Type entityType)`).
- Argument guard clauses for programmer error stay exceptions at the public boundary
  (`ArgumentNullException.ThrowIfNull(x)`) — a contract check, not `Result<T>` error handling.
- Mark framework-internal public API that is exempt from semver with an internal-API marker attribute
  (the `[EntityFrameworkInternal]` analog); prefer real `internal` + `[InternalsVisibleTo]` when the
  surface need not be public at all.

```csharp
public sealed record TimescaleDbTranslatorDependencies
{
    public required ISqlExpressionFactory SqlExpressionFactory { get; init; }
    public required IRelationalTypeMappingSource TypeMappingSource { get; init; }
}
```

## Visibility

- `sealed` by default; open a type for inheritance only deliberately.
- Prefer `internal` for building-block types; expose to the test project with `[assembly: InternalsVisibleTo("…UnitTests")]` rather than making them `public`.

## XML docs (Microsoft-style)

- XML doc comments on the public surface of a library/package.
- `<inheritdoc/>` on overrides and interface implementations instead of copy-pasting summaries.
- `<see cref="…"/>` for type/member links; `<see href="https://…">` for external links.

## Decision Notes

- When unsure between two rule interpretations, pick the one that keeps records immutable, business logic in domain, and errors in `Result<T>`.
- If a third-party library forces a constructor or mutable state, isolate it behind a factory or wrapper rather than leaking the pattern into the domain.

## Related skills

- `ddd` — where domain logic/aggregates/modules live.
- `web-api` — endpoint/handler/slice shape.
- `validation` — length-typed VOs, request limits.
- `hardening` — security/ops for exposed services.
- `observability` — where the cross-cutting constants, alloc-minimal processors, and `Guid.CreateVersion7` ids are exercised.
- `testing` — how the tests for this code are written (xUnit/Shouldly/NSubstitute/Testcontainers).
