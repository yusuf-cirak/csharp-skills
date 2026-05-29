---
name: csharp-testing
description: User's personal C#/.NET testing standard. Fixed stack — xUnit (test framework), Shouldly (assertions), NSubstitute (mocking, ports only), Testcontainers (real Postgres/Redis in integration tests with Respawn cleanup), Bogus (seeded test-data builders / Object Mother), and NetArchTest (architecture/layer-boundary tests). Covers test project layout & naming, `Method_State_Expectation` naming, AAA structure, asserting on `Result<T>`/`Option<T>` monads, unit-vs-integration split, `ICollectionFixture` Testcontainers base class, and DDD layer-boundary enforcement. MUST be used whenever writing, editing, reviewing, or generating ANY C# test (`*.Tests`/`*.IntegrationTests` projects, `[Fact]`/`[Theory]`, fixtures, test doubles) or setting up a test project. Use ALONGSIDE `csharp-language`; references domain/endpoint rules from `dotnet-ddd`, `aspnetcore-web-api`, `aspnetcore-production-hardening`.
---

# C# Testing Standard

The user's permanent testing rules. Fixed stack — do not substitute libraries without explicit opt-in. Apply alongside `csharp-language` (records/monads/idioms). Production-grade CI/SAST/DAST/mutation gates live in `aspnetcore-production-hardening` → CI/Test Security; this skill governs how tests themselves are written.

## Stack (fixed)

| Concern | Library | Note |
|---|---|---|
| Test framework | **xUnit** | `[Fact]` / `[Theory]` + `[InlineData]`/`[MemberData]`/`[ClassData]`. |
| Assertions | **Shouldly** | `result.ShouldBe(x)`. Free/OSS, expressive failure messages. No bare `Assert.*` except where Shouldly lacks an equivalent. |
| Mocking | **NSubstitute** | `Substitute.For<T>()`. Mock **outbound ports only** (HttpClient handlers, brokers, clocks) — never the domain. |
| Integration infra | **Testcontainers** | Real Postgres/Redis/etc. via Docker. No in-memory provider for DB-bound tests. |
| DB reset | **Respawn** | Truncate between integration tests instead of recreating the container. |
| Test data | **Bogus** | Seeded `Faker<T>`; wrapped in factory-based builders / Object Mother. Deterministic. |
| Architecture | **NetArchTest** | Enforce DDD layer boundaries. (`ArchUnitNET` acceptable if richer rules needed.) |
| Coverage | **coverlet** | Collected in CI; threshold gate (see CI section). |

## Project layout & naming

- One test project per production project: `<Project>.UnitTests`, `<Project>.IntegrationTests`, plus a single solution-wide `Architecture.Tests`.
- Mirror the namespace/folder structure of the system under test.
- Test class: `<TypeUnderTest>Tests` (unit) — one class per SUT.
- Test method: **`Method_State_Expectation`**, e.g. `Create_WhenValueExceedsMax_ReturnsFailure`.
- AAA layout with blank-line separation; no comments needed when sections are obvious.

```csharp
public sealed class ShortTextFactoryTests
{
    [Fact]
    public void Create_WhenValueExceedsMax_ReturnsFailure()
    {
        var input = new string('x', InputLimits.ShortTextMaxLength + 1);

        var result = ShortTextFactory.Create(input);

        result.IsFailure.ShouldBeTrue();
        result.Error.ShouldContain("exceeds");
    }

    [Fact]
    public void Create_WhenValid_ReturnsSuccessWithValue()
    {
        var result = ShortTextFactory.Create("ok");

        result.IsSuccess.ShouldBeTrue();
        result.Value.GetValue().ShouldBe("ok");
    }
}
```

## Asserting on monads

Domain factories/handlers return `Result<T>`/`Option<T>` (see `../csharp-coding-standards/references/monads.md`). Assert on the monad, never via try/catch:

- Success: `result.IsSuccess.ShouldBeTrue();` then `result.Value.ShouldBe(...)`.
- Failure: `result.IsFailure.ShouldBeTrue();` then assert the error.
- `Option<T>`: assert `HasValue` / `IsNone`, then the value.
- Exceptions are an expectation only for genuinely exceptional paths: `Should.Throw<T>(() => ...)`.

## Unit tests

- Test domain behavior through factories and methods — they hold the rules.
- Inject test doubles **only for outbound side-effect ports** (`IClock`, `IEmailSender`, `HttpMessageHandler`, message bus). Pure domain services take real instances.
- No mocking of types you own that have no side effects — construct them.
- One logical assertion per test (Shouldly chains on one subject are fine).

```csharp
var clock = Substitute.For<IClock>();
clock.UtcNow.Returns(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));

var result = Subscription.Renew(clock);

result.IsSuccess.ShouldBeTrue();
```

## Test data — Bogus builders

Wrap `Bogus.Faker<T>` in a builder / Object Mother so call sites read intent, not field soup. **Seed the faker** for determinism. Build through the production factory so invariants hold.

```csharp
public sealed class CustomerBuilder
{
    private readonly Faker _faker = new(locale: "en") { Random = new Randomizer(localSeed: 1) };
    private string _name = "Acme";

    public CustomerBuilder WithName(string name) { _name = name; return this; }

    public Customer Build()
        => CustomerFactory.Create(
            id: _faker.Random.Guid(),
            name: _name).Value;

    public static Customer Any() => new CustomerBuilder().Build();
}
```

## Integration tests — Testcontainers

Real dependencies in Docker. No EF in-memory / SQLite substitute for Postgres-bound behavior. Share one container across a collection; reset state per test with Respawn.

```csharp
public sealed class PostgresFixture : IAsyncLifetime
{
    public PostgreSqlContainer Container { get; } =
        new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();

    private Respawner _respawner = null!;
    public string ConnectionString => Container.GetConnectionString();

    public async Task InitializeAsync()
    {
        await Container.StartAsync();
        await MigrateAsync(ConnectionString);
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        _respawner = await Respawner.CreateAsync(conn,
            new RespawnerOptions { DbAdapter = DbAdapter.Postgres });
    }

    public async Task ResetAsync()
    {
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        await _respawner.ResetAsync(conn);
    }

    public Task DisposeAsync() => Container.DisposeAsync().AsTask();
}

[CollectionDefinition(nameof(PostgresCollection))]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>;

[Collection(nameof(PostgresCollection))]
public abstract class IntegrationTestBase(PostgresFixture fixture) : IAsyncLifetime
{
    protected PostgresFixture Fixture { get; } = fixture;
    public Task InitializeAsync() => Task.CompletedTask;
    public Task DisposeAsync() => Fixture.ResetAsync(); // clean slate after each test
}
```

- API-level integration uses `WebApplicationFactory<TEntryPoint>` with the container's connection string injected via config override.
- Assert real HTTP behavior the hardening rules promise: `ProblemDetails` shape, security headers, `429` envelope (see `aspnetcore-production-hardening`).
- Every test that touches I/O passes a `CancellationToken`.

## Architecture tests (DDD boundaries)

One `Architecture.Tests` project enforcing the layering from `dotnet-ddd`. Fail the build on violation.

```csharp
[Fact]
public void Domain_ShouldNotDependOn_InfrastructureOrApplication()
{
    var result = Types.InAssembly(DomainAssembly.Reference)
        .Should()
        .NotHaveDependencyOnAny("GoActivity.*.Infrastructure", "GoActivity.*.Application")
        .GetResult();

    result.IsSuccessful.ShouldBeTrue(
        $"violations: {string.Join(", ", result.FailingTypeNames ?? [])}");
}
```

Minimum rules: Domain depends on nothing outward; Application never references Infrastructure types directly; Contracts stay DTO/interface-only; modules don't reference each other's internals (only `*.Contracts`).

## Coverage / CI

- coverlet collects line + branch coverage; CI gate (default ≥ 80% on changed projects, tune per repo).
- Tests run in CI on every PR; integration tests need Docker available on the runner.
- Mutation testing (`Stryker.NET`) on critical domain paths — owned by `aspnetcore-production-hardening` → CI/Test Security.

## Anti-patterns (forbidden)

- EF in-memory or SQLite standing in for the real database in DB-bound tests — use Testcontainers.
- Mocking domain entities/value objects, or mocking concrete types you own with no side effects.
- `Thread.Sleep` for async timing — await the real signal / use polling with a bounded timeout.
- Shared mutable state between tests; order-dependent tests. Each test is isolated (Respawn handles DB).
- Asserting on `result.Value` without first asserting `IsSuccess` (NRE hides the real failure).
- Non-deterministic data: unseeded `Bogus`, `DateTime.Now`, `Guid.NewGuid()` in assertions — inject `IClock`, seed fakers.
- Logic in tests (loops/conditionals deciding the assertion) — prefer `[Theory]` data.

## Related skills

- `csharp-language` — records/monads/idioms the SUT and builders follow.
- `dotnet-ddd` — the layer boundaries the architecture tests enforce.
- `aspnetcore-web-api` — endpoints exercised by integration tests.
- `aspnetcore-input-validation` — `InputLimits`/VO rules asserted in unit tests.
- `aspnetcore-production-hardening` — CI gates, mutation testing, security-header/`429` assertions.
