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

## Query shaping — selective, fan-out-free, composed

How you *write* the LINQ decides the plan. Applies to all EF Core versions; `IN`/parameter limits are
SQL Server. Learned rules, most impactful first:

- **Filter the driving table first ("filter driving tables first").** Lead the query from the
  smallest / most-selective set (ideally an indexed seek) and join outward — don't scan the big table
  and test membership after the join. Prefer
  `from link in Links.Where(l => l.OwnerKey == id) join e in Entities on link.EntityId equals e.Id`
  over `from e in Entities where e.Links.Any(l => l.OwnerKey == id)`. Same result, index seek instead
  of a scan-then-filter.
- **Push predicates into the join, not after it.** `join loc in Loc.Where(l => l.Lang.StartsWith(c))
  on e.Id equals loc.EntityId into g from loc in g.DefaultIfEmpty()` filters the joined side *before*
  the join. A trailing `where` on a joined column joins everything first.
- **Keep subqueries `IQueryable` — don't materialize mid-pipeline.** `.ToList()` then
  `.Contains(theList)` emits a client-side `IN (@p0..@pN)`: an extra round trip **and** on SQL Server
  it breaches the **~2100-parameter ceiling** on big sets. Leave the subquery composable so it becomes
  `IN (SELECT …)` / `EXISTS`. Materialize only at the edge — the page you actually return.
- **`EXISTS` / semi-join instead of a fan-out `LEFT JOIN`.** Joining a one-to-many (or a bridge table
  used only to test membership) multiplies rows and forces `Distinct()` / in-memory `GroupBy`. When you
  only need "a match exists" or "is a member", use `.Any(...)` or `memberIds.Contains(e.Id)` — no
  fan-out, no dedup, no wrong counts.
- **Project columns, not whole entities.** Selecting entities (or an intermediate DTO holding whole
  entities) and projecting in memory pulls every column of every joined table. Project the exact fields
  into the response shape inside the `IQueryable` so SQL selects only those — EF then prunes
  cardinality-preserving joins whose columns you never read.
- **Count the same shape you page.** `totalRecord` and the returned rows must run over the *same*
  filtered set, or the total won't match. Counting a pre-join query while listing a fan-out join (or
  vice versa) makes the badge disagree with the list.
- **Lean base for count + page-keys; hydrate only the page.** Derive the total and the page's key set
  from a join-light query (no display-only joins ⇒ no fan-out, no `Distinct`), then join the heavy
  display tables only for the ≤ pageSize keys you return. Turns 3 full-width scans into 2 cheap ones + 1
  tiny hydrate.
- **Delete no-op work.** `Include(...)` before a projection is silently ignored by EF — remove it (it
  misleads readers into thinking data is fetched). Drop `Distinct()` when the key is already the PK and
  nothing fans out. Cut dead entity projections the caller never reads.

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
