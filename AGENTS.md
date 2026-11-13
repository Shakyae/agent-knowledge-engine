# AGENTS.md — Agent Knowledge Engine (AKE) development rules

This repository develops **AKE itself**. For the file a *target* project receives, use `templates/project/AGENTS.md`; never confuse the two.

## Contract first

- `docs/architecture.md` is the authoritative current v0.1 interface (CLI surface, file formats, gates, verification levels), including explicitly authorized amendments. Propose other changes to the Lead before deviating; do not silently widen scope.
- v0.1 is Markdown + Git + a dependency-free Node CLI. No plugin, MCP server, vector store, background service, web UI or third-party dependency.
- Node >= 20, ESM only, `node:test`, cross-platform paths, LF newlines.

## Honesty of claims

- Skill/AGENTS rules are soft constraints; ordinary file tools can bypass the publish gate. Never describe approval as a security boundary.
- Only claims backed by executed evidence belong in documentation: label unit tests, isolation-project integration tests, real DSH Single-Session runs, real Agent Teams runs, and unverified behaviour separately.
- Record assumptions rather than presenting them as verified facts.

## Knowledge workflow (dogfooding)

Before the first related AKE CLI action, give one concise user notice for the stage; coalesce consecutive calls. In Agent Teams the Lead/owner sends a unified notice and members report to the Lead without duplicate user notices. Search `.agents/notes/`, `docs/defensive-patterns/`, `docs/postmortem/`, `docs/cookbook/` with `node scripts/ake.mjs search <terms>`, then read only hits whose `scope`/`verified` still apply and report category/applicability.

After finishing a task, visibly report whether a durable result maps to Agent Note, Defensive Pattern, Postmortem or Cookbook; if there is truly no new reusable result, say `AKE · 本次无新增知识`. If a potentially useful result lacks evidence, report it as pending evidence rather than “no new knowledge.” Disclose pending candidate IDs and why they remain unpublished. Prefer updating an existing authoritative document over creating a parallel one. Candidates live in `.ake/candidates/`; promote through bound review. Author self-review records the author's own check but does not substitute for an independent reviewer in the AKE Skill workflow; do not call it independent. Obtain explicit user authorization before approval and publication (the CLI retains its automatic mode for compatibility), without silently rewriting formal knowledge.

## Working rules

- Small steps; run `npm test` (and `npm run check` when knowledge docs changed) after each meaningful change.
- Do not create knowledge directories or abstractions that no current requirement justifies.
- Do not modify the DSH host, plugins, installed packages, team presets or user-level configuration; do not install global dependencies.
- Temporary or generated files go under ignored paths (`tests/.work/`, `.ake-tmp/`), never in the repo root.
