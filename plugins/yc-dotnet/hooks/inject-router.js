#!/usr/bin/env node
// yc-dotnet SessionStart hook.
// Injects the C# / .NET router instruction into every session so `yc-dotnet:index`
// is invoked for C# work WITHOUT requiring a manual block in the user's global CLAUDE.md.
// Portable: ships with the plugin, active on any machine right after install.

const bannerLines = [
  "# C# / .NET Auto-Standards (yc-dotnet)",
  "",
  "When working in any C# / .NET / ASP.NET Core context (files: `.cs`, `.csproj`, `.sln`, `.slnx`, `.razor`, `.cshtml`, `Directory.Build.props`, `Directory.Packages.props`, `global.json`; or topics: C#, .NET, ASP.NET Core, EF Core, DDD in .NET, xUnit/NUnit/MSTest), invoke `yc-dotnet:index` via the Skill tool BEFORE writing or modifying code.",
  "",
  "`yc-dotnet:index` is a router — it dispatches to focused sub-skills (`csharp`, `ddd`, `web-api`, `validation`, `hardening`, `testing`) based on the activity. Read its dispatch table and invoke EVERY sub-skill it recommends for the task (combinations are the norm). Always include `yc-dotnet:csharp` for any `.cs` edit.",
];

const out = {
  additionalContext: bannerLines.join("\n"),
};

console.log(JSON.stringify(out));
