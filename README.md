# csharp-skills

Personal C# / .NET / ASP.NET Core coding standards, packaged as a Claude Code plugin (`dotnet`) so they install on any machine without re-copying skill files into `~/.claude/skills`.

## What's inside

A 7-skill family (plugin name: `dotnet`) fronted by a thin **router** (no rules, just a dispatch table + shared `references/`):

| Skill | Scope |
|---|---|
| `dotnet:index` | Router / index — dispatches to the others |
| `dotnet:csharp` | Always-on base: namespaces, immutable records + factories, DUs, value objects, monads, LINQ, performance |
| `dotnet:ddd` | DDD tactical patterns, Modular Monolith + Vertical Slice layout |
| `dotnet:web-api` | Endpoint/handler/slice shape, MediatR/FastEndpoints, FluentValidation basics, pagination |
| `dotnet:validation` | `InputLimits`, length-typed `Text` VOs, validator rules, JSON/Kestrel hardening, output encoding |
| `dotnet:hardening` | Rate limiting, idempotency, authn/authz, headers, crypto, EF hardening, SSRF, observability, CI |
| `dotnet:testing` | xUnit + Shouldly + NSubstitute + Testcontainers + Bogus + NetArchTest |

Shared `references/` (single source of truth) live next to the router under `index/references/`: `value-object-base.md`, `input-limits.md`, `monads.md`. Cross-skill links are **relative** (`../index/references/...`) so they resolve both as a plugin and as loose `~/.claude/skills`.

## Install

```
/plugin marketplace add yusuf-cirak/csharp-skills
/plugin install dotnet@yusufcirak
```

(Local testing before push: `/plugin marketplace add C:/Users/yusuf.cirak/repos/claude-csharp-standards`.)

Already installed under the old `@yc` name? The marketplace key does not re-key in place — re-register once:

```
/plugin marketplace remove yc
/plugin marketplace add https://github.com/yusuf-cirak/csharp-skills
/plugin install dotnet@yusufcirak
/reload-plugins
```

(The plugin was renamed `yc-dotnet` → `dotnet`, so skill namespaces are now `dotnet:*`. If your global `CLAUDE.md` references the old `yc-dotnet:index`, update it to `dotnet:index`.)

## After installing — remove the loose copies

These skills currently also live directly in `~/.claude/skills/`. Once the plugin is installed and verified, delete the loose copies to avoid duplicate skill names:

```
csharp-coding-standards/  csharp-language/  dotnet-ddd/
aspnetcore-web-api/  aspnetcore-input-validation/
aspnetcore-production-hardening/  csharp-testing/
```

## CLAUDE.md note

The global `~/.claude/CLAUDE.md` block that names `dotnet:index` as the mandatory entry point is **user config**, not a plugin artifact — it does not ship in this plugin. Keep it in your own dotfiles. The skill `description` fields already carry the "MUST be used" triggers, so the standards still activate without it; the CLAUDE.md block just reinforces routing through `dotnet:index`.

## Editing workflow

Edit the canonical copies under `plugins/dotnet/skills/...`, bump `version` in `plugins/dotnet/.claude-plugin/plugin.json`, commit, then `/plugin marketplace update yusufcirak` on installed machines to pull the new version.

## opencode

These same skills work in [opencode](https://opencode.ai) — it reads `SKILL.md` natively and has a `skill` tool. See [`opencode/README.md`](opencode/README.md) to sync the 8 skills into opencode and enable the same auto-routing via `AGENTS.md`.
