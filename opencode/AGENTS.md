# C# / .NET Auto-Standards (yc-dotnet, opencode)

When working in any C# / .NET / ASP.NET Core context (files: `.cs`, `.csproj`, `.sln`, `.slnx`, `.razor`, `.cshtml`, `Directory.Build.props`, `Directory.Packages.props`, `global.json`; or topics: C#, .NET, ASP.NET Core, EF Core, DDD in .NET, xUnit/NUnit/MSTest), invoke the **`index`** skill via the `skill` tool BEFORE writing or modifying code.

`index` is a router — it dispatches to focused sub-skills based on the activity. Read its dispatch table and invoke EVERY sub-skill it recommends for the task (combinations are the norm). Always include **`csharp`** for any `.cs` edit.

## Skill names in opencode

opencode invokes skills by their **bare folder name** through the `skill` tool, e.g. `skill({ name: "index" })`. The router text refers to sub-skills as `yc-dotnet:<short>` — that `yc-dotnet:` prefix is the Claude Code namespace; **ignore it in opencode** and use the bare name:

| Router says | Use in opencode |
|---|---|
| `yc-dotnet:index` | `index` |
| `yc-dotnet:csharp` | `csharp` |
| `yc-dotnet:ddd` | `ddd` |
| `yc-dotnet:web-api` | `web-api` |
| `yc-dotnet:validation` | `validation` |
| `yc-dotnet:hardening` | `hardening` |
| `yc-dotnet:observability` | `observability` |
| `yc-dotnet:testing` | `testing` |

Flow: `skill({ name: "index" })` first → then invoke each sub-skill the dispatch table matches (always `csharp` for `.cs`).
