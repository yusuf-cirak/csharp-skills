# Value Object base type + converters

Shared base for all value objects. Used by `csharp-language` (VO pattern), `dotnet-ddd` (domain VOs), and `aspnetcore-input-validation` (length-typed `Text` VOs).

## Base type

```csharp
public abstract record ValueObject;

public abstract record ValueObject<T> : ValueObject
    where T : notnull
{
    protected T Value { get; init; }

    public abstract T GetValue();

    public static implicit operator T(ValueObject<T> valueObject) => valueObject.GetValue();

    public override string ToString() => GetValue().ToString();
}
```

## Example `Text`

```csharp
public sealed record Text : ValueObject<string>
{
    public override string GetValue() => Value;

    public static Text From(string? value) => new() { Value = value! };

    public static implicit operator Text(string? value) => From(value);
    public static implicit operator string(Text? text) => text?.Value ?? string.Empty;
}
```

## Value Object JSON

```csharp
public sealed class TextJsonConverter : JsonConverter<Text>
{
    public override bool HandleNull => true;

    public override Text? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => Text.From(reader.GetString());

    public override void Write(Utf8JsonWriter writer, Text? value, JsonSerializerOptions options)
        => writer.WriteStringValue(value?.GetValue() ?? string.Empty);
}

public static class ValueObjectJsonConverters
{
    public static IList<JsonConverter> JsonConverters =>
        new List<JsonConverter>
        {
            new TextJsonConverter(),
            new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseUpper)
        };
}
```

## Value Object EF Core

```csharp
public sealed class TextConverter : ValueConverter<Text, string>
{
    public TextConverter()
        : base(v => v.GetValue(), v => Text.From(v))
    {
    }
}

public DbContext ApplyDefaultConventions(ModelConfigurationBuilder configurationBuilder)
{
    configurationBuilder
        .Properties<Text>()
        .HaveConversion<TextValueConverter>();

    return dbContext;
}
```
