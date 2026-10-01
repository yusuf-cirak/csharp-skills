---
name: csharp
description: Use when writing, editing, reviewing, or generating any C# code (`.cs`/`.csproj`/`.slnx`) or discussing C#/.NET language features, idioms, naming, or style — even if not explicitly mentioned. The always-on base layer for every other C# skill in this family.
---

# C# Language & Style

The user's permanent C# language idioms. Apply by default to any `.cs` edit. If a framework or language version makes a rule impossible, write the closest equivalent and note why. This is the base layer every other C# skill (`ddd`, `web-api`, `validation`, `hardening`) builds on — those own domain modeling, endpoints, request/DTO limits, and service hardening respectively; this file owns everything else: file-scoped namespaces & organization, immutability, strict record design (`<Name>Factory` statics), discriminated unions, polymorphic state machines, value objects, monadic error handling, LINQ-over-loops, modern C# language features, `Span<T>`/performance rules, source-generated JSON/AOT, `TimeProvider`, async/concurrency/Channels, keyed DI, and Microsoft framework-author conventions.

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
- Use immutable collections inside records. Pick by access pattern, not by habit: **`ImmutableArray<T>`** (array-backed, no per-element node overhead) when the collection is built once at construction and only read afterward — the common case for a record property. **`ImmutableList<T>`** (AVL tree, O(log n) indexing) only when you actually derive many incremental versions over time (undo history, persistent snapshots) and need a cheap `Add`/`Remove` that doesn't copy the whole collection — it costs more per element than an array, so don't reach for it as the default.
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
- **Zero-allocation LINQ (check before writing):** if the project already references **ZLinq** (Cysharp) — check `.csproj`/`Directory.Packages.props` — use it; its struct-based drop-in removes the usual "LINQ allocates, so drop to a loop on hot paths" trade-off, so LINQ stays the default even in measured-hot code. If the project uses a different zero-alloc LINQ approach, match it. If neither is present, plain `System.Linq` is fine for cold paths — but when a change touches a per-request/per-record/per-message LINQ chain (the Hot-path allocation discipline cases below), **proactively suggest adding ZLinq** there rather than quietly dropping to a manual loop; ask before adding the package.

### ZLinq drop-in setup (when ZLinq is the project's choice)

Install ZLinq as a **drop-in** so call sites keep plain LINQ syntax — no `.AsValueEnumerable()` chaining:

```bash
dotnet add package ZLinq
dotnet add package ZLinq.DropInGenerator
```

The source generator emits extension methods that take overload priority over `System.Linq` for the selected target types, so the ZLinq method is picked whenever name and arguments match. Configure it with one assembly attribute:

```csharp
// New project — most aggressive: everything (incl. IEnumerable<T>) routes through ZLinq.
// Generate into the app's default namespace, NOT global (""): with Enumerable included,
// a global drop-in makes normal System.Linq unreachable; a namespaced one lets a file
// opt back into System.Linq by not importing that namespace.
[assembly: ZLinq.ZLinqDropInAttribute("MyApp", ZLinq.DropInGenerateTypes.Everything)]

// Legacy/existing project — use Collection (Array | Span | Memory | List), NOT Everything:
// the Enumerable drop-in returns ValueEnumerable where existing code expects IEnumerable<T>
// (a real problem on net9+), so it breaks existing call sites. Without Enumerable,
// `.AsEnumerable()` stays available as the System.Linq escape hatch.
[assembly: ZLinq.ZLinqDropInAttribute("MyApp", ZLinq.DropInGenerateTypes.Collection)]
```

`DropInGenerateTypes` is a flags enum — `Array`, `Span` (Span/ReadOnlySpan), `Memory` (Memory/ReadOnlyMemory), `List`, `Enumerable` (IEnumerable), combinable (`Array | Span`), with predefined combos `Collection = Array | Span | Memory | List` and `Everything = Collection | Enumerable`. Where the drop-in isn't configured (a quick script, someone else's repo), chain `.AsValueEnumerable()` manually before the operators.

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

## LINQ — common runtime pitfalls

These fail at runtime, not compile time, and the bug is in the shape of the data, not the code — the
same LINQ call is correct on a clean sample and crashes (or silently loses rows) in production. Know
these before reaching for `Single`/`ToDictionary`/`Join`/`Zip`:

- **`Single()`/`SingleOrDefault()` throw `InvalidOperationException: Sequence contains more than one
  element`** the moment the source has a duplicate. Use `Single*` only when uniqueness is an actual
  invariant you want enforced (a PK/unique-index lookup — the exception is a real bug signal). Otherwise
  use `First()`/`FirstOrDefault()`, which don't assert cardinality.
- **`ToDictionary(keySelector)` throws `ArgumentException: An item with the same key has already been
  added`** on the first duplicate key — a very common crash once "the key is unique" turns out to be an
  assumption, not a constraint. Pick the right duplicate-handling tool instead of discovering this in
  prod:
  ```csharp
  // Throws on any duplicate OrderId — fine only if OrderId is truly unique in `lines`.
  var byId = lines.ToDictionary(l => l.OrderId);

  // Never throws — built for 1-to-many; indexer returns an empty sequence for a missing key.
  ILookup<Guid, OrderLine> byOrder = lines.ToLookup(l => l.OrderId);

  // Duplicates expected, want a Dictionary<K, List<T>> anyway:
  var grouped = lines.GroupBy(l => l.OrderId).ToDictionary(g => g.Key, g => g.ToList());

  // Duplicates expected, only want one (first-wins):
  var firstWins = lines.GroupBy(l => l.OrderId).ToDictionary(g => g.Key, g => g.First());
  ```
- **An in-memory `Join` fans out (duplicates rows) when the join key isn't unique on one side** — the
  same cartesian-explosion shape as the EF `Include` issue (see `../index/references/ef-core-data-access.md`),
  just client-side and silent (no exception, just more rows than expected). If the relationship is
  naturally 1-to-many, use `GroupJoin` (or the `join … into g` query-syntax form) to get one row per
  left element with its matches grouped, instead of an `Join` that multiplies.
  **`GroupJoin`'s real payoff is N+1 avoidance, not just correctness**: batch-load the related data for
  *every* item in **one** query (not per-item), then correlate it to each item in memory. Nested
  `GroupJoin` handles a two-level "many items, each with many related rows, grouped by an intermediate
  key" shape without a second round trip per group:
  ```csharp
  // One query for ALL related rows across every requested owner — not one query per owner (that's N+1).
  var relatedRows = await db.RelatedRows
      .Where(r => ownerIds.Contains(r.OwnerId))
      .ToListAsync(ct);

  // Correlate entirely in memory: group once by the outer key, then — inside each group — by the
  // inner key, so every (owner, item) pair gets exactly its own matches, zero extra queries.
  var byOwner = relatedRows.GroupBy(r => r.OwnerId);
  var correlated = owners.GroupJoin(byOwner, o => o.Id, g => g.Key, (owner, ownerGroups) => new
  {
      Owner = owner,
      Matches = ownerGroups.SelectMany(g => g) // empty, not null, when an owner has no matches
  });
  ```
- **`Zip` silently truncates to the shorter sequence** — no exception, just dropped trailing elements
  from the longer one. If equal length is actually an invariant (paired data that must line up 1:1),
  assert it explicitly (`if (a.Count != b.Count) throw …` / `Guard.Against…`) before zipping — don't
  let a length mismatch disappear into quietly-wrong output.
- **Enumerating a deferred source twice re-runs the whole pipeline** — a second `foreach`/`.Any()`/
  `.Count()` over the same un-materialized `IEnumerable<T>`/`IQueryable<T>` re-executes it: a second DB
  round trip for an `IQueryable`, or a different result each time for a non-deterministic source
  (`Random`, `DateTime.Now`-filtered). Decide once per method: still composing a query (stay
  `IQueryable`/`IEnumerable`, see the EF reference on keeping subqueries composable) or about to consume
  it more than once (materialize once with `.ToList()`/`.ToArray()` first) — don't do both in the same
  method.
- **`Min()`/`Max()`/`Average()`/`Aggregate()` (no seed) throw `InvalidOperationException: Sequence
  contains no elements`** on an empty source. Guard with `.Any()` first, use the nullable-returning
  overload where one exists, or seed `Aggregate` with an explicit starting value so an empty source
  returns the seed instead of throwing.
- **`==`/`.Equals()` on two sequences compares references, not contents** — two logically identical
  `List<T>`s (or any two `IEnumerable<T>`) compare unequal. Use `SequenceEqual()` for element-wise
  comparison (and `SetEquals`/order-insensitive comparison explicitly when order shouldn't matter).

## Modern C# language features (codified)

- **`<Nullable>enable</Nullable>` is mandatory** project-wide; `required` members express
  construction-time contracts (a missing `required` is a compile error, not a runtime null).
- **Collection expressions** `[..]` (C# 12) for collection init and spread:
  `int[] ids = [..left, ..right, 0];` — prefer over `.Concat().ToArray()` for fixed shapes.
- **Primary constructors** (C# 12): use on services/DI types and `record`s. **Avoid** on mutable
  stateful `class`es where the captured parameter masks a field (use explicit `_field` there).
- **List / property patterns** over index-and-length checks; `file`-local types (C# 11) for
  single-file helpers that must not leak into the namespace.
- **`field` keyword** (C# 14 / .NET 10) for a property with validation but no hand-declared backing
  field: `public int Age { get => field; init => field = value >= 0 ? value : throw …; }`.
- `params ReadOnlySpan<T>` (C# 13) is a hot-path allocation primitive — see Performance below.

## Performance

- Prefer `Span<T>` / `ReadOnlySpan<T>` over `string` / `ReadOnlyMemory<T>` when possible.
- Prefer `IEnumerable<T>` over `List<T>` when callers only enumerate.
- Prefer arrays over `List<T>` for fixed-size collections.
- **Pre-size a `List<T>`/`Dictionary<K,V>` when the final count is known or boundable** (`new List<T>(count)`, `collection.Query(ct).Count()` before materializing, a known page size): an unsized `List<T>` grows by **doubling + copying the whole backing array** on every resize past capacity — for a large collection built in a loop this is the actual allocation-and-copy cost, not the elements themselves. One upfront `capacity` argument skips every intermediate reallocation. `LinkedList<T>` is **not** a fix for this — it trades the array-copy cost for a separate heap node *per element*, which is more total allocation for most workloads, not less; reach for it only when you need O(1) insert/remove at an arbitrary known node and have measured that the per-node overhead is still cheaper than the alternative.
- Use `IAsyncEnumerable<T>` for async streams instead of materialized lists.
- Prefer singleton lifetime over scoped when state allows.
- **`FrozenSet<T>` / `FrozenDictionary<K,V>`** for static, read-mostly lookup sets built once at startup (sensitive-key sets, scope tables, allow-lists) — faster reads than `HashSet`/`Dictionary`.
- **Time-ordered ids**: `Guid.CreateVersion7()` (UUIDv7) for entity/message/correlation ids — index-friendly (monotonic) unlike random v4.

### String operations — ZString

ZString (Cysharp) is the preferred string-building/formatting library: zero-allocation `Concat`/`Format`/`Join` and pooled builders. **If the project already references ZString, use it by default** for any string build/concat/format. **If it doesn't, recommend it and ask before adding the package** (`dotnet add package ZString`); until it's in, fall back to `StringBuilder`/interpolation.

```csharp
using Cysharp.Text; // ZString

var line = ZString.Format("settled {0} in {1}ms", orderId, elapsedMs); // no boxing, no intermediate strings
var csv  = ZString.Join(',', ids);

using var sb = ZString.CreateStringBuilder(); // pooled buffer — always `using`
sb.Append(header);
sb.AppendFormat("{0:D8}", sequence);
var payload = sb.ToString();

using var utf8 = ZString.CreateUtf8StringBuilder(); // writes UTF8 directly — pairs with IBufferWriter<byte>
```

- `ZString.Concat`/`Format`/`Join` over `string.Concat`/`string.Format`/`string.Join`, and over `+`/interpolation on hot paths.
- `ZString.CreateStringBuilder()` over `new StringBuilder()` for loop concatenation — same rule as the hot-path discipline below, minus the builder allocation.
- `CreateUtf8StringBuilder()` when the destination is bytes (network, file, `IBufferWriter<byte>`) — skips the UTF16→UTF8 transcode.

### Pooled streams — `RecyclableMemoryStreamManager`

A `new MemoryStream()` built and thrown away per request/item (serializing a response, encoding an
image, buffering a file) is exactly the per-request allocation the Hot-path rules below target.
**`Microsoft.IO.RecyclableMemoryStreamManager`** (`Microsoft.IO.RecyclableMemoryStream` package,
Microsoft-maintained) is the standard fix — a pooled, chunked `MemoryStream` replacement with the same
API. Register one singleton `RecyclableMemoryStreamManager` per workload (not per call) and call
`.GetStream()` instead of `new MemoryStream()`.

**Size the pool's buffers to the workload's actual payload size, not a generic default.** The options
are a pooling *shape*, not a universal constant — a service handling 1–3 MB images needs different
numbers than one handling 10 KB JSON payloads. Pick `BlockSize` so a typical payload needs only a few
blocks (too small ⇒ a payload spans many blocks, more bookkeeping; too large ⇒ small payloads waste
pooled memory), and size `MaximumBufferSize`/the free-pool ceilings so your *measured* peak concurrent
usage fits without constantly growing/shrinking the pool.

```csharp
// Sized for an image-processing workload where payloads run 1–3 MB:
public static readonly RecyclableMemoryStreamManager ImageStreams = new(
    new RecyclableMemoryStreamManager.Options
    {
        BlockSize = 1024 * 1024,                    // 1 MB blocks — a 1-3 MB image needs only 1-3 of them
        LargeBufferMultiple = 1024 * 1024 * 2,       // once a stream outgrows block-pooling, grow in 2 MB steps
        MaximumBufferSize = 1024 * 1024 * 4,         // ceiling a bit above the largest expected payload
        MaximumSmallPoolFreeBytes = 1024 * 1024 * 8, // sized to expected concurrency, not guessed
        MaximumLargePoolFreeBytes = 1024 * 1024 * 16,
    });

var ms = ImageStreams.GetStream();   // pooled, not `new MemoryStream()`
await image.SaveAsJpegAsync(ms, encoder, cancellationToken: cancellationToken);
ms.Position = 0;                     // GetStream() doesn't reset position for you — do this before reading back
```

A service with multiple payload shapes (small JSON responses *and* multi-MB uploads) is a signal for
**two** differently-sized managers, not one generic one sized for the largest case.

### Hot-path allocation discipline

On per-request / per-record / per-message paths (middleware, log/OTel processors, serializers), allocation is the cost — be deliberate:

- Allocate **nothing** when there's nothing to do (early-return before building a list); build **one pre-sized** collection when you must.
- **Closures are the easiest allocation to miss.** A lambda that captures outer-scope state (a local, `this`) compiles to a heap-allocated display class *plus* a delegate — invisible in the source; a heap-allocation profiler (JetBrains "Heap Allocations" / CLR Heap Allocation Analyzer) is how you actually spot it. On a path invoked thousands of times/sec (message pipelines, middleware, a `ConcurrentDictionary.GetOrAdd` factory) this is a measured cost, not a theoretical one. Mark the lambda `static` (C# 9+) to forbid capture at compile time — the compiler raises **CS8820** on any captured variable, turning an invisible allocation into a build error. If the lambda needs outer state, pass it through the generic `Action<TState>`/`Func<TState,TResult>` state-overload (not `Action<object>` — that boxes a value-type state):

  ```csharp
  // Captures `multiplier` → display-class + delegate allocation every call.
  IEnumerable<int> Doubled(IEnumerable<int> xs) => xs.Select(x => x * multiplier);

  // static + generic state → no closure, no boxing.
  IEnumerable<int> Doubled(IEnumerable<int> xs, int multiplier) => xs.Select(multiplier, static (x, m) => x * m);
  ```

  Known BCL gotcha: `dict.GetOrAdd(key, k => Expensive(k, captured))` allocates the closure on **every call, even cache hits** (the factory is built before the lookup runs) — use the 4-arg overload instead: `dict.GetOrAdd(key, static (k, state) => Expensive(k, state), captured)`. For a chained delegate pipeline (a behavior/middleware chain) where each link would otherwise capture the next, thread the ordered link collection through the context object instead, so each static lambda reads its neighbor from context rather than closing over it.

  **Method groups follow the same rule, with one asset you get for free.** A method-group conversion to a delegate (`xs.Select(SomeMethod)`, `Run(worker.Handle)`) is sugar for exactly the same `new Func<...>(...)` as a lambda — **unless the target is a `static` method**, in which case the compiler caches the delegate in a static field and reuses it, so converting the same static method group inside a loop costs nothing even without hoisting (measured: 1M iterations, `xs => f(x)` with `f` rebound to a static method-group every iteration → **0 bytes** allocated). An **instance** method group (`worker.InstanceMethod`) captures the target instance like a closure and is **not** cached — the same loop with an instance method group measured **64 bytes/iteration** (one delegate per conversion). If the target is an instance method and the conversion happens inside a hot loop, convert it **once** outside the loop into a local and reuse that — measured back down to a one-time 64 bytes total, regardless of iteration count.
- If the project references a zero-alloc LINQ library (ZLinq or equivalent — see the LINQ rules), reach for it to keep LINQ allocation-free here. Otherwise drop to an indexer loop for the measured-hot bit — plain `System.Linq` iterator + delegate objects ARE real allocations on these paths.
- Read a **known key set directly** (e.g. `Activity.GetBaggageItem(key)`) instead of enumerating a collection whose getter allocates an iterator (`Activity.Baggage`).
- **Cache** reflection results, compiled delegates, and converted strings; use `ReferenceEquals` fast-paths when an unchanged value is cached as the same instance.
- **Microsoft-style primitives** for these paths: `ArrayPool<T>.Shared.Rent(n)` for transient buffers, returned in `finally`; `stackalloc` for small buffers under a ~256-byte ceiling with a heap fallback (`Span<char> b = len <= 256 ? stackalloc char[len] : new char[len];`); `ZString.CreateStringBuilder()` — or `StringBuilder` when ZString isn't referenced (see String operations above) — when concatenating in a loop (never `+=` a string per iteration); `[MethodImpl(MethodImplOptions.AggressiveInlining)]` only on a proven-hot tiny method, with a one-line comment saying why.
- **Pooled collections** when a collection is built and discarded every request/iteration: `Collections.Pooled` (`PooledList<T>`/`PooledDictionary<K,V>`) rents its backing array from `ArrayPool<T>` and returns it on `Dispose()` — always `using`. Reserve for measured hot spots; plain `List<T>` everywhere else.
- **`params ReadOnlySpan<T>`** (C# 13) on hot variadic APIs — zero per-call array allocation vs `params T[]`.
- **Provider query translators are the canonical LINQ-violation site** — the no-LINQ/no-closures rule above applies hardest there.
- **`readonly struct` escape hatch**: a value object **proven** (benchmark in hand) to allocate on a hot per-row path may become a `readonly struct` instead of a `record` — still immutable, still factory-constructed, kept out of the domain layer. Default stays `record`.
- Keep these tricks **out of cold paths** — readability wins everywhere that isn't measured-hot.

## JSON serialization — source generation & AOT (.NET 6+; AOT .NET 8+)

- Declare a **`JsonSerializerContext`** for serialized types so there is no startup reflection and the
  code is trimming / Native-AOT safe.

```csharp
[JsonSerializable(typeof(ActivityResponse))]
[JsonSerializable(typeof(IReadOnlyList<ActivityResponse>))]
public sealed partial class AppJsonContext : JsonSerializerContext;
```

- **Wiring is owned by `validation`** (§4 Global `JsonSerializerOptions` hardening) — feed the context
  to the hardened options' resolver chain there; do **not** configure `ConfigureHttpJsonOptions` here.
- For a Native-AOT service set `<PublishAot>true</PublishAot>`; prefer Minimal API + `TypedResults` and
  avoid reflection-based serializers/mappers.

## Async (library code, Microsoft-style)

Library/framework code runs under callers we don't control — follow the dotnet/runtime + EF Core rules:

- `ConfigureAwait(false)` on **every** `await` in library/framework code. Drop it only in app-level
  ASP.NET request or UI code where the synchronization context is wanted.
- Return `ValueTask`/`ValueTask<T>` when the method frequently completes synchronously (cache hits,
  fast-path lookups) — avoids a per-call `Task` allocation. Use `Task` when it almost always awaits.
- Thread `CancellationToken` through to every downstream async call; default it as the last public
  parameter (`CancellationToken cancellationToken = default`).
- No `async void` except event handlers — an unobserved exception there crashes the process.

## Time (`TimeProvider`, .NET 8+)

- **`TimeProvider` is the time abstraction** — inject it; call `timeProvider.GetUtcNow()`,
  `GetTimestamp()`/`GetElapsedTime()`, `CreateTimer()`. **Do not hand-roll an `IClock`** and never read
  `DateTime.Now`/`DateTimeOffset.UtcNow`/`Guid.NewGuid()` directly in code under test.
- Production binds the singleton `TimeProvider.System`; tests inject `FakeTimeProvider`
  (`Microsoft.Extensions.TimeProvider.Testing`) and call `Advance(...)` (see `testing`).

```csharp
public sealed class Subscription(TimeProvider time)
{
    public bool IsExpired(DateTimeOffset until) => time.GetUtcNow() >= until;
}
builder.Services.AddSingleton(TimeProvider.System);
```

## Concurrency primitives

- **`Parallel.ForEachAsync`** (.NET 6) for throttled async fan-out (`MaxDegreeOfParallelism` +
  `CancellationToken`) — prefer it over a hand-rolled `SemaphoreSlim` loop.
- **`SemaphoreSlim`** for async gating, **`Interlocked`** for lock-free counters, **`Lazy<T>`** for
  thread-safe one-time init. Reach for a `lock` only when none of these fit.
- **`IAsyncEnumerable<T>` streaming** annotates the token with **`[EnumeratorCancellation]`** and yields
  bounded batches rather than materializing the whole set:

```csharp
public async IAsyncEnumerable<IReadOnlyList<Row>> StreamAsync(
    [EnumeratorCancellation] CancellationToken ct = default) { /* yield batches of N */ }
```

## Background work & channels (.NET 8+)

- In-process producer/consumer → **`System.Threading.Channels`** (`Channel.CreateBounded<T>` for
  backpressure), drained by a `BackgroundService`. No external broker for purely internal hand-offs —
  for **distributed/broker reliability** (retry, DLQ, outbox) see `hardening` → Background Jobs & Messaging.
- Use **`IHostedLifecycleService`** (.NET 8) when you need ordered `Starting/Started/Stopping/Stopped`
  hooks rather than ad-hoc startup code.

```csharp
public sealed class WorkQueue : BackgroundService
{
    private readonly Channel<WorkItem> _channel = Channel.CreateBounded<WorkItem>(1000);
    public ValueTask EnqueueAsync(WorkItem item, CancellationToken ct) => _channel.Writer.WriteAsync(item, ct);
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await foreach (var item in _channel.Reader.ReadAllAsync(ct)) await ProcessAsync(item, ct);
    }
}
```

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

For AOT/trimming and zero-reflection validation, source-generate the validator with **`[OptionsValidator]`** (.NET 8+) instead of `ValidateDataAnnotations()`:

```csharp
[OptionsValidator]
public sealed partial class JwtOptionsValidator : IValidateOptions<JwtOptions>;
services.AddOptions<JwtOptions>().BindConfiguration(JwtOptions.SectionName).ValidateOnStart();
services.AddSingleton<IValidateOptions<JwtOptions>, JwtOptionsValidator>();
```

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
- Argument/precondition guards for **programmer error** stay exceptions at the public boundary — a
  contract check, not `Result<T>` business validation. If the project already references
  **Ardalis.GuardClauses** (a common choice for this vocabulary), use it consistently —
  `Guard.Against.Null(input)`, `Guard.Against.NullOrWhiteSpace(name)`, `Guard.Against.NegativeOrZero(qty)`,
  `Guard.Against.OutOfRange(page, nameof(page), 1, InputLimits.MaxPageSize)` — and add project-specific
  checks as **`IGuardClause` extension methods** so every call site stays `Guard.Against.X(...)`.
  Otherwise match whatever guard convention the codebase already has (hand-rolled static `Guard` class,
  etc.) rather than introducing a competing vocabulary mid-codebase. If guards are scattered and
  inconsistent (ad-hoc `if (x is null) throw` / bare `ArgumentNullException.ThrowIfNull` with no shared
  vocabulary), recommend adding **Ardalis.GuardClauses** and ask before adding the package — it's the
  de-facto standard for this and worth introducing once there's no existing convention to clash with.
  Reserve guards for impossible/contract violations — expected, user-facing validation failures flow
  through `Result<T>` / FluentValidation (see `validation`, `ddd` factory rules), never a thrown guard.

```csharp
Guard.Against.NullOrWhiteSpace(name);
Guard.Against.OutOfRange(page, nameof(page), 1, InputLimits.MaxPageSize);

// project-specific guard as an extension — call site stays Guard.Against.*
public static class GuardExtensions
{
    public static string InvalidEmail(this IGuardClause guard, string input,
        [CallerArgumentExpression(nameof(input))] string? name = null)
        => EmailRegex.IsMatch(input) ? input : throw new ArgumentException("invalid email", name);
}
```
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

## Dependency injection — keyed services (.NET 8+)

When one interface has several interchangeable implementations (strategy / variant / named backend),
register them **keyed** instead of a custom factory or marker types:

```csharp
services.AddKeyedSingleton<ICacheStore, RedisCacheStore>("redis");
services.AddKeyedSingleton<ICacheStore, MemoryCacheStore>("memory");

public sealed class Handler([FromKeyedServices("redis")] ICacheStore cache);
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
- `validation` — length-typed VOs, request limits, the `JsonSerializerOptions` wiring for the source-gen context above.
- `hardening` — security/ops for exposed services; distributed background-job/outbox reliability.
- `observability` — where the cross-cutting constants, alloc-minimal processors, and `Guid.CreateVersion7` ids are exercised.
- `testing` — how the tests for this code are written (xUnit/Shouldly/NSubstitute/Testcontainers); `FakeTimeProvider` for the `TimeProvider` above.
