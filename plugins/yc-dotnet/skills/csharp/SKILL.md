---
name: csharp
description: User's personal C# language & style idioms — the always-on base layer for ANY `.cs` work. Covers file-scoped namespaces and file organization, immutability, strict record design with `<Name>Factory` static classes, discriminated unions, value objects (base type + pattern), YC.Monad `Result<T>`/`Option<T>` error handling, LINQ-over-imperative-loops, and `Span<T>`/`IEnumerable<T>` performance rules. MUST be used whenever writing, editing, reviewing, or generating ANY C# code (`.cs`/`.csproj`/`.slnx`) or discussing C#/.NET language features — even if unmentioned. This is the foundation; for domain modeling also use `ddd`, for endpoints `web-api`, for request/DTO limits `validation`, for service hardening `hardening`.
---

# C# Language & Style

The user's permanent C# language idioms. Apply by default to any `.cs` edit. If a framework or language version makes a rule impossible, write the closest equivalent and note why. This is the base layer every other C# skill (`ddd`, `web-api`, `validation`, `hardening`) builds on.

## Namespaces & File Organization

- File-scoped namespaces. Namespace mirrors folder structure.
- One type per file. Exception: a type used only within a single file may stay in that file.
- Use `GlobalUsings.cs` to keep files clean.
- Register services in `DependencyInjection.cs`. Split into partials like `DependencyInjection.Database.cs`, `DependencyInjection.Observability.cs` to keep registration readable.

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
- Replace magic numbers/strings with `const`. If non-compile-time, use `static readonly`.
- Prefer singleton lifetime over scoped when state allows.

## Decision Notes

- When unsure between two rule interpretations, pick the one that keeps records immutable, business logic in domain, and errors in `Result<T>`.
- If a third-party library forces a constructor or mutable state, isolate it behind a factory or wrapper rather than leaking the pattern into the domain.

## Related skills

- `ddd` — where domain logic/aggregates/modules live.
- `web-api` — endpoint/handler/slice shape.
- `validation` — length-typed VOs, request limits.
- `hardening` — security/ops for exposed services.
- `testing` — how the tests for this code are written (xUnit/Shouldly/NSubstitute/Testcontainers).
