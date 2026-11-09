# AGENTS.md — Agent Knowledge Engine (AKE) development rules

This repository develops **AKE itself**. For the file a *target* project receives, use `templates/project/AGENTS.md`; never confuse the two.

## Contract first

- `docs/architecture.md` is the frozen v0.1 interface (CLI surface, file formats, gates, verification levels). Propose a change to the Lead before deviating; do not silently widen scope.
- v0.1 is Markdown + Git + a dependency-free Node CLI. No plugin, MCP server, vector store, background service, web UI or third-party dependency.
- Node >= 20, ESM only, `node:test`, cross-platform paths, LF newlines.

## Honesty of claims

- Skill/AGENTS rules are soft constraints; ordinary file tools can bypass the publish gate. Never describe approval as a security boundary.
- Only claims backed by executed evidence belong in documentation: label unit tests, isolation-project integration tests, real DSH Single-Session runs, real Agent Teams runs, and unverified behaviour separately.
- Record assumptions rather than presenting them as verified facts.

## Knowledge workflow (dogfooding)

Before changing code here, retrieve relevant knowledge from `.agents/notes/`, `docs/defensive-patterns/`, `docs/postmortem/`, `docs/cookbook/` with `node scripts/ake.mjs search <terms>`, then read only the hits whose `scope`/`verified` still apply.

After finishing a task, check whether durable, evidence-backed knowledge emerged. Prefer updating an existing authoritative document over creating a parallel one. Candidates live in `.ake/candidates/`; formal knowledge is only ever promoted through `review` → human `approve` → `publish`, and never silently rewritten.

## Working rules

- Small steps; run `npm test` (and `npm run check` when knowledge docs changed) after each meaningful change.
- Do not create knowledge directories or abstractions that no current requirement justifies.
- Do not modify the DSH host, plugins, installed packages, team presets or user-level configuration; do not install global dependencies.
- Temporary or generated files go under ignored paths (`tests/.work/`, `.ake-tmp/`), never in the repo root.
