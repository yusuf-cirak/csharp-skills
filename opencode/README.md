# yc-dotnet for opencode

The same C# / .NET standards that ship as the Claude Code plugin `yc-dotnet` also run in
[opencode](https://opencode.ai). opencode reads `SKILL.md` files natively and has a built-in
`skill` tool, so the **same skill files** are reused — no duplication, single source of truth
under `../plugins/yc-dotnet/skills/`.

opencode plugins can't inject the system prompt, so the always-on router instruction lives in
`AGENTS.md` (the opencode equivalent of the Claude Code `SessionStart` hook).

## Install

### 1. Sync the skills

```
node opencode/sync-skills.js          # copy into ~/.config/opencode/skills/
node opencode/sync-skills.js --link   # or symlink (true single-source; re-edits propagate)
```

This places `index/`, `csharp/`, `ddd/`, `web-api/`, `validation/`, `hardening/`,
`observability/`, `testing/` under `~/.config/opencode/skills/`, preserving folder names so the
relative `../index/references/...` links keep resolving.

> **Name-collision note:** opencode keys skills by folder name, so generic names like `index` and
> `testing` share the global `~/.config/opencode/skills/` namespace. If you already have skills
> with those names, prefer the project-scoped dir `./.opencode/skills/` instead, or rename.

### 2. Enable auto-routing

Either copy the banner to your global opencode instructions:

```
cp opencode/AGENTS.md ~/.config/opencode/AGENTS.md
```

…or, if you already keep a global `~/.config/opencode/AGENTS.md` (opencode uses the first
matching global file — it does not merge), add this repo's `AGENTS.md` to the `instructions`
array in `opencode.json` instead:

```json
{
  "instructions": ["/abs/path/to/csharp-skills/opencode/AGENTS.md"]
}
```

## Usage

In a C# / .NET context, opencode invokes the router first, then the dispatched sub-skills —
by **bare name** (the `yc-dotnet:` prefix in the router text is the Claude Code namespace; ignore
it here):

```
skill({ name: "index" })   # read the dispatch table
skill({ name: "csharp" })  # always, for any .cs edit
skill({ name: "web-api" })  # + whatever else the activity matches
```

## Keeping in sync

The skills are edited once under `../plugins/yc-dotnet/skills/`. After editing, re-run
`node opencode/sync-skills.js` (copy mode) — or use `--link` once so future edits propagate
without re-running.
