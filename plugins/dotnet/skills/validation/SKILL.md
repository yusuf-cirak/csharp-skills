---
name: validation
description: User's personal rules for hardening untrusted input at the DTO / serialization boundary in ASP.NET Core. Covers the central `InputLimits` constants, length-typed `Text` value objects (`ShortText`/`MediumText`/`LongText`/`XLongText`, `Email`/`Slug`/`Url`/`PhoneNumber`) instead of raw `string`, mandatory FluentValidation rules (MaximumLength, collection caps, `.IsInEnum()`, URL scheme allowlist, control-char rejection, ReDoS-safe regex), global `JsonSerializerOptions` hardening, Kestrel/`FormOptions` limits, per-endpoint size override, mandatory pagination, output encoding, and the forbidden anti-patterns. Use when defining or reviewing request DTOs/commands/queries, request validators, JSON/serialization config, or any code that accepts client input. Use ALONGSIDE `csharp` and `web-api`. Rate limiting, authn, and other network hardening live in `hardening`.
---

# ASP.NET Core Input Security & Serialization Limits

Every endpoint, DTO, validator, value object, and JSON configuration MUST enforce hard limits on input size, depth, and shape. Never trust client input. Apply these rules by default — only relax them with an explicit, justified opt-in. Pairs with `web-api` (endpoint shape) and `csharp` (VO/record idioms).

## 1. Central `InputLimits` constants

All length / size / count limits live in one shared static class (place in `BuildingBlocks.Domain` or the project's equivalent shared layer). Validators, value objects, endpoints, and Kestrel config reference these — never inline magic numbers.

Canonical definition (single source of truth):
→ `../index/references/input-limits.md`

## 2. Length-typed `Text` value objects

Free-form `string` properties on DTOs/domain are forbidden. Use a value object whose type carries the length constraint, so the limit cannot be forgotten. Factories return `Result<T>` (YC.Monad if available; otherwise the codebase's existing monad — see `../index/references/monads.md`). The `ValueObject<T>` base is in `../index/references/value-object-base.md`.

```csharp
public sealed record ShortText : ValueObject<string>
{
    public override string GetValue() => Value;
}

public static class ShortTextFactory
{
    public static Result<ShortText> Create(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Result.Failure<ShortText>("value is required");
        if (value.Length > InputLimits.ShortTextMaxLength)
            return Result.Failure<ShortText>($"value exceeds {InputLimits.ShortTextMaxLength} characters");
        if (value.Any(char.IsControl))
            return Result.Failure<ShortText>("value contains control characters");
        return Result.Success(new ShortText { Value = value });
    }
}
```

Provide variants per length tier and per semantic shape:

- `ShortText` (≤ 256), `MediumText` (≤ 1 024), `LongText` (≤ 4 000), `XLongText` (≤ 16 000).
- `Email`, `Slug`, `Url` (https-only scheme), `PhoneNumber` — each with its own factory rules.

DTOs/commands/queries declare these VO types, never raw `string`.

## 3. FluentValidation — mandatory rules

Every request validator MUST include:

- `string` field → `.NotEmpty().MaximumLength(InputLimits.X)` (matching the chosen tier).
- `IEnumerable<T>` / `ImmutableList<T>` field → `.NotNull()` + `.Must(c => c.Count() <= InputLimits.MaxCollectionItems)`.
- `enum` field → `.IsInEnum()`.
- Email → `.EmailAddress().MaximumLength(InputLimits.ShortTextMaxLength)`.
- URL → custom rule enforcing `Uri.TryCreate(..., UriKind.Absolute)` + scheme whitelist (`https` only, unless deliberately broader).
- Reject control characters: `.Must(s => s is null || !s.Any(char.IsControl))`.
- Regex usage: MUST pass `RegexOptions.NonBacktracking` or an explicit `TimeSpan` timeout. Plain `new Regex(pattern)` is forbidden (ReDoS risk).

Counter-example (forbidden):

```csharp
RuleFor(x => x.Title).NotEmpty(); // missing MaximumLength
RuleFor(x => x.Tags).NotNull();   // missing count cap
```

## 3b. Validators run in the pipeline (mediator pipeline behavior)

Validators MUST execute **before** the handler, automatically — not by a hand-written `Validate()` call the developer can forget. Register a mediator `IPipelineBehavior` that runs every `IValidator<TRequest>` and short-circuits on failure. Works with whichever mediator the project uses — which one to pick (MediatR is commercial from v13; default is the free source-gen `Mediator`) is decided in `../index/references/mediator.md`.

```csharp
public sealed class ValidationBehavior<TRequest, TResponse>(IEnumerable<IValidator<TRequest>> validators)
    : IPipelineBehavior<TRequest, TResponse> where TRequest : notnull
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken ct)
    {
        if (!validators.Any()) return await next(ct);
        var ctx = new ValidationContext<TRequest>(request);
        var failures = (await Task.WhenAll(validators.Select(v => v.ValidateAsync(ctx, ct))))
            .SelectMany(r => r.Errors).Where(f => f is not null).ToArray();
        if (failures.Length != 0) throw new ValidationException(failures);
        return await next(ct);
    }
}
```

Wire it with `cfg.AddOpenBehavior(typeof(ValidationBehavior<,>))` + `services.AddValidatorsFromAssemblies(assemblies, includeInternalTypes: true)`. The thrown `ValidationException` is mapped by the global handler to a **RFC 9457 `ValidationProblemDetails`** (HTTP 400, `errors` = field → messages) — see `hardening` → Error Handling. Handlers then assume a valid request.

## 4. Global `JsonSerializerOptions` hardening

Configure once in `Program.cs` or `DependencyInjection.Serialization.cs`. Apply to both `ConfigureHttpJsonOptions` (Minimal APIs / FastEndpoints) and `AddJsonOptions` (MVC) where used.

```csharp
services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.MaxDepth = InputLimits.MaxJsonDepth;
    o.SerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow;
    o.SerializerOptions.PropertyNameCaseInsensitive = false;
    o.SerializerOptions.AllowTrailingCommas = false;
    o.SerializerOptions.ReadCommentHandling = JsonCommentHandling.Disallow;
    o.SerializerOptions.NumberHandling = JsonNumberHandling.Strict;
    o.SerializerOptions.DefaultBufferSize = 16 * 1024;
    // Enums as strings with an explicit naming policy — never leak/accept bare integer enum values.
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseUpper));
    foreach (var converter in ValueObjectJsonConverters.JsonConverters)
        o.SerializerOptions.Converters.Add(converter);
});
```

Rationale: `Disallow` unmapped members causes unknown fields to return 400 — typos and probing attacks fail loudly. `MaxDepth = 32` blocks pathological nesting. Strict number handling rejects quoted/`NaN`/`Infinity` numbers.

For trimming / Native AOT (and to drop startup reflection), add a source-generated `JsonSerializerContext` to the resolver chain — keep these hardened options, just feed it the generated metadata (see `csharp` → JSON serialization):

```csharp
o.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default);
```

## 5. Kestrel & FormOptions limits

`Program.cs`:

```csharp
builder.WebHost.ConfigureKestrel(o =>
{
    o.Limits.MaxRequestBodySize = InputLimits.MaxRequestBodyBytes;
    o.Limits.MaxRequestLineSize = 8 * 1024;
    o.Limits.MaxRequestHeadersTotalSize = 32 * 1024;
    o.Limits.MaxRequestHeaderCount = 100;
    o.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(120);
});

builder.Services.Configure<FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = InputLimits.MaxUploadBytes;
    o.ValueLengthLimit = InputLimits.LongTextMaxLength;
    o.KeyLengthLimit = 256;
    o.ValueCountLimit = 1024;
});
```

## 6. Per-endpoint override (opt-in only)

Endpoints that legitimately need a larger body (file upload, bulk import) MUST opt in explicitly. They MUST NOT disable the limit.

```csharp
[RequestSizeLimit(InputLimits.MaxUploadBytes)]
[Consumes("multipart/form-data")]
public sealed class Endpoint : BaseEndpoint<Request, Result<UploadResult>>
{
    // ...
}
```

`[DisableRequestSizeLimit]` is forbidden — treat as a code-review block.

## 7. Pagination is mandatory

Every list/query endpoint paginates. No filterless `GetAll`. Inherit a shared base:

```csharp
public abstract record PagedRequest
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 50;
}

public sealed class PagedRequestValidator : AbstractValidator<PagedRequest>
{
    public PagedRequestValidator()
    {
        RuleFor(x => x.Page).GreaterThan(0);
        RuleFor(x => x.PageSize).InclusiveBetween(1, InputLimits.MaxPageSize);
    }
}
```

Concrete request validators inherit / include the paged validator.

## 8. Rate limiting

Every endpoint is rate-limited. Burst guard + steady quota + concurrency cap + failed-auth lockout, all partitioned by authenticated principal. Full policy and code live in `hardening` → **Tiered Rate Limiting & Burst Protection**.

## 9. Anti-patterns (forbidden)

- `dynamic` or `JsonElement` request payloads — define a typed DTO instead.
- Raw `string` properties on request/command/query types — use length-typed VOs.
- A validator with a `string` rule missing `MaximumLength`.
- `[DisableRequestSizeLimit]`.
- `new Regex(pattern)` without `RegexOptions.NonBacktracking` or a `TimeSpan` timeout.
- `PropertyNameCaseInsensitive = true` unless explicitly justified.
- Logging raw request bodies / payloads (PII + size risk). Log shape (counts, ids), not content.
- Returning unbounded result sets from queries.

## 10. Output encoding

When emitting user-controlled data into HTML/JS/CSS contexts, use `HtmlEncoder.Default`, `JavaScriptEncoder.Default`, or `UrlEncoder.Default`. Never concatenate `Text` value directly into a template. For JSON APIs the configured `JsonSerializerOptions` handles escaping; do not hand-write JSON.

## Related skills

- `csharp` — value object / record / monad idioms.
- `web-api` — endpoint/handler/validator shape.
- `hardening` — rate limiting, authn/authz, headers, file upload, SSRF, deserialization safety.
- `testing` — unit tests asserting `InputLimits`/VO factory rules; integration tests for the 400/validation envelope.
