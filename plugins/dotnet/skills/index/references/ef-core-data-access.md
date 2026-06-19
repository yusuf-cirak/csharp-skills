# EF Core data access — performance & value-object persistence (single source of truth)

> EF Core. Version tags inline. Security/hardening rules for EF live in `hardening` → EF Core
> Hardening; this ref owns **performance** and **domain-type persistence**.

## Bulk operations (EF 7+)

Mutate sets server-side — no load-modify-save round trip.

```csharp
await ctx.Orders.Where(o => o.IsStale)
    .ExecuteUpdateAsync(s => s
        .SetProperty(o => o.Archived, true)
        .SetProperty(o => o.UpdatedAt, timeProvider.GetUtcNow()), ct);

await ctx.Sessions.Where(s => s.ExpiresAt < now).ExecuteDeleteAsync(ct);
```

**Caveat:** bulk ops bypass the change tracker, so `SaveChanges` interceptors don't run and **domain
events don't fire** — the rule and rationale live in `ddd` → Domain-event dispatch. Maintenance/bulk
paths only.

## Query performance

- **`AddDbContextPool<T>`** (EF 2+) — reuse `DbContext` instances; default pool 1024. Big latency/GC
  win under load. Constructor must take only `DbContextOptions` (no per-request injected state).
- **Compiled queries** (EF 5+) — pre-compile hot, repeated LINQ:
  ```csharp
  private static readonly Func<AppDbContext, Guid, CancellationToken, Task<Order?>> s_byId =
      EF.CompileAsyncQuery((AppDbContext c, Guid id, CancellationToken ct) =>
          c.Orders.FirstOrDefault(o => o.Id == id));
  ```
- **`AsSplitQuery()`** (EF 5+) — on any query with **multiple collection `Include`s**, to avoid
  cartesian explosion (one row per child × child blows up the result set).
- **`AsNoTrackingWithIdentityResolution()`** (EF 5+) — read graphs without tracking but still
  de-duplicating shared references. Default reads stay `AsNoTracking` (see `hardening`).
- **Compiled models** (EF 6+) — `dotnet ef dbcontext optimize` for large schemas / fast cold start;
  wire with `optionsBuilder.UseModel(MyModels.Instance)`.

## Value-object & strongly-typed-id persistence

- **Complex types** (EF / .NET 8) — map a value object into the owner's table without a separate
  entity:
  ```csharp
  modelBuilder.Entity<Order>().ComplexProperty(o => o.ShippingAddress);
  ```
- **Value converters** (EF 5+) — persist single-value VOs / strongly-typed IDs as primitives:
  ```csharp
  modelBuilder.Entity<Order>().Property(o => o.Id)
      .HasConversion(id => id.Value, value => OrderIdFactory.Create(value).Value);
  ```
  Vogen-generated IDs (see `ddd`) ship an EF converter — register it via
  `HasConversion<OrderId.EfCoreValueConverter>()`. Pair with the JSON converter list in
  `value-object-base.md` so the same VO round-trips over HTTP and the DB.
