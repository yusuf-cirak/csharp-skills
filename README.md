# csharp-skills

Personal C# / .NET / ASP.NET Core coding standards, packaged as a Claude Code plugin so they install on any machine without re-copying skill files into `~/.claude/skills`.

## What's inside

A 7-skill family fronted by a thin **router** (no rules, just a dispatch table + shared `references/`):

| Skill | Scope |
|---|---|
| `csharp-coding-standards` | Router / index — dispatches to the others |
| `csharp-language` | Always-on base: namespaces, immutable records + factories, DUs, value objects, monads, LINQ, performance |
| `dotnet-ddd` | DDD tactical patterns, Modular Monolith + Vertical Slice layout |
| `aspnetcore-web-api` | Endpoint/handler/slice shape, MediatR/FastEndpoints, FluentValidation basics, pagination |
| `aspnetcore-input-validation` | `InputLimits`, length-typed `Text` VOs, validator rules, JSON/Kestrel hardening, output encoding |
| `aspnetcore-production-hardening` | Rate limiting, idempotency, authn/authz, headers, crypto, EF hardening, SSRF, observability, CI |
| `csharp-testing` | xUnit + Shouldly + NSubstitute + Testcontainers + Bogus + NetArchTest |

Shared `references/` (single source of truth): `value-object-base.md`, `input-limits.md`, `monads.md`. Cross-skill links are **relative** (`../csharp-coding-standards/references/...`) so they resolve both as a plugin and as loose `~/.claude/skills`.

## Install

```
/plugin marketplace add yusuf-cirak/csharp-skills
/plugin install csharp-standards@yc
```

(Local testing before push: `/plugin marketplace add C:/Users/yusuf.cirak/repos/claude-csharp-standards`.)

## After installing — remove the loose copies

These skills currently also live directly in `~/.claude/skills/`. Once the plugin is installed and verified, delete the loose copies to avoid duplicate skill names:

```
csharp-coding-standards/  csharp-language/  dotnet-ddd/
aspnetcore-web-api/  aspnetcore-input-validation/
aspnetcore-production-hardening/  csharp-testing/
```

## CLAUDE.md note

The global `~/.claude/CLAUDE.md` block that names `csharp-coding-standards` as the mandatory entry point is **user config**, not a plugin artifact — it does not ship in this plugin. Keep it in your own dotfiles. The skill `description` fields already carry the "MUST be used" triggers, so the standards still activate without it; the CLAUDE.md block just reinforces routing.

## Editing workflow

Edit the canonical copies in `~/.claude/skills/...`, then re-sync into `plugins/csharp-standards/skills/` and bump `version` in `plugins/csharp-standards/.claude-plugin/plugin.json` before committing.
