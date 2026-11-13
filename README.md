# Agent Knowledge Engine (AKE) v0.1

A portable, low-intrusion engineering-knowledge layer for coding agents. Agents retrieve existing project knowledge when relevant, capture reusable results in one of four knowledge kinds, and publish through a bound review/authorization gate. The AKE Skill workflow requires an eligible independent reviewer and explicit user authorization before publication; author self-review is recorded honestly but does not substitute for that review. The CLI retains its automatic authorization mode for compatibility, but the Skill does not use it as a default.

There is no server, database or plugin: knowledge is Markdown in the project's Git repository, behaviour is described by a Skill plus `AGENTS.md`, and a dependency-free Node CLI performs the format checks, keyword retrieval, candidate lifecycle and publish gate.

**Naming:** AKE = **A**gent **K**nowledge **E**ngine, and the CLI command is `ake` (the project abbreviation). The earlier working name `PKO` (project-knowledge-ops) and the CLI name `kno` were retired before v0.1 was delivered; the rename is recorded in `.agents/notes/implemented/process/2026-11-10-rename-working-name-to-ake.md`.

## What it solves

Agents start every task in a new context. Durable, project-specific knowledge — why a design is what it is, which defect classes keep reappearing, what actually happened during an incident, which procedure was verified — otherwise has to be rediscovered or is lost.

AKE gives that knowledge:

- **a place**: four knowledge kinds adapted from the official DSH conventions,
- **a way in**: `ake search` plus a Skill that defines when and how to search,
- **a way to grow**: candidates captured where the experience emerged, with evidence and applicability recorded,
- **a way to stay honest**: explicit review/authorization modes, a hash-bound publish gate and audit records,
- **an honest boundary**: it is a process and tooling layer, not a security mechanism (see [Limitations](#limitations)).

## Requirements

- Node.js >= 20 (no third-party dependencies).
- Git (initialization refuses to run outside a valid Git work tree).

## Use AKE in a project (v0.1)

### Install the Skill and initialize projects

AKE itself requires Node.js >= 20; the current [Vercel Skills CLI](https://github.com/vercel-labs/skills) requires Node.js >= 22.20. From an AKE source checkout, after reviewing existing installations as described below:

```bash
# Shared installation: choose the agents you actually use.
npx skills add . --skill ake --global --agent codex --agent claude-code

# From the AKE checkout, preview and initialize each Git project separately.
node scripts/ake.mjs init --dir /path/to/your/project --dry-run
node scripts/ake.mjs init --dir /path/to/your/project

# Optional project-level Skill instead: run inside the target project.
npx skills add /path/to/ake-checkout --skill ake --agent codex --agent claude-code
```

`init` creates knowledge directories, configuration and a self-contained CLI at `.ake/tools/scripts/ake.mjs`; it does not install or inspect Skills. Its output explicitly reminds you to install the `ake` Skill separately; presence does not prove it was loaded. Each project's data stays in that project. When commands run without `--project`, the CLI searches from the current directory to the nearest Git root and uses the nearest ancestor with a complete valid `.ake/config.json`, supporting an AKE subproject inside a larger repository. A broken or unsafe inner `.ake` stops resolution instead of falling through to a parent AKE project. Explicit `--project <dir>` always uses that exact directory (and its own defaults when no config exists, including an empty `.ake/` created by earlier writes). Effective paths are validated after defaults are merged, so inherited or custom paths through an escaping symlink are rejected even with partial or missing config. `init` leaves differing existing files untouched and reports conflicts; it may still create other safe items. An existing unmarked `AGENTS.md` gets the current marked trigger block appended by default, preserving all original bytes and remaining idempotent. A prior AKE-managed block with older/different rules is not automatically upgraded: it is reported as a conflict and left untouched. Back it up and manually review/merge the new rules; AKE never silently overwrites an existing block. Malformed marker blocks also remain conflicts and are never overwritten. `--merge-agents` is retained as a compatibility flag.

The distributed `skills/ake/` bundle also contains `bootstrap.mjs` and an offline copy of the init CLI, its modules, templates and minimal package metadata. After installing this Skill, it can initialize a project without an AKE source checkout: use the absolute Skill base directory supplied by the Skill loader and an absolute target path. The target may be either a Git work-tree root or a project subdirectory in an existing parent work tree; initialization remains in the exact requested directory and never runs `git init` or creates a nested repository. Review `node <absolute-skill-directory>/bootstrap.mjs --dir <absolute-target> --dry-run`; a conflict observed in that preview stops the subsequent apply. Bootstrap cleans `GIT_*` environment overrides before verifying Git and fails closed for missing Git, bare repositories and unrecognized Git errors. If both `.ake/config.json` and `.ake/tools/scripts/ake.mjs` already exist, bootstrap preserves them and does not repeat or upgrade initialization. It compares config version with bundled package metadata without executing the project CLI; a mismatch is reported, and a match does not prove the CLI's own version. Before any write using an old or unknown project CLI, ask the user to run its read-only `status --json` and verify the reported `project` is exactly the intended target. The agent does not execute an existing project CLI during bootstrap or proceed with writes before this check. If it reports a parent root, back up and manually review migration/update guidance against the official AKE source; never auto-copy, upgrade or overwrite existing project files. This is project-local and never installs a global Skill. Missing offline bundle files are reported by exact path; restore/update the Skill from an official AKE source checkout using the installation instructions above. Preview/apply is not atomic or TOCTOU-safe: a concurrent writer can change files between them, and the core initializer may then produce mixed outcomes. Use a single writer; the zero-write conflict guarantee applies only when the preview detects a conflict, not concurrent changes after preview. The prompt-level requirement to ask before proceeding when the selected target is not a Git project is a soft Skill instruction; script tests establish refusal/zero writes, not real agent questioning or compliance.

Skills CLI 1.7.6 was tested on macOS with a temporary HOME and project: for the commands above it created a real canonical `.agents/skills/ake` directory and a Claude Code `.claude/skills/ake` symlink to it, both globally and in the project. This is not a symlink to the source checkout. Modes and fallback behavior may vary, especially on Windows; `--copy` requests independent copies. The [Skills agent table](https://github.com/vercel-labs/skills/blob/main/docs/agents.md) identifies Codex and Claude Code paths, not DSH as a target. DSH's filesystem provider can scan `.agents/skills` at project/user scope when enabled and configured accordingly; `DSH_AGENTS_HOME` and custom roots can differ. Installation alone does not prove an Agent loaded the Skill. Real Claude Code, Codex and Windows loading were not tested.

### Updates and migration

**Before running third-party install or update**, inspect and back up existing `ake` and `knowledge-ops` files, including project `.agents/skills/`, `.claude/skills/`, user `~/.agents/skills/`, `~/.claude/skills/`, flat `knowledge-ops.md`, and any configured DSH roots. Back up outside scanned Skill roots. Skills CLI is a separate tool: in the isolated macOS test, repeating `skills add` replaced a customized canonical `SKILL.md`; do not assume it preserves existing content or links. Manually merge your customizations and remove or move old entries only after reviewing them; otherwise differently named or project-level Skills may shadow or duplicate shared instructions. Neither `ake init` nor the migration hint modifies existing Skills.

For a local checkout installation, update the checkout using your normal Git workflow, inspect changes and backups, then rerun the appropriate `npx skills add` command above. For a supported remote source, consult [Skills CLI update documentation](https://github.com/vercel-labs/skills/blob/main/docs/commands.md#skills-update); check scope and customizations before using `npx skills update -g ake` or `npx skills update -p ake`. The old `ake skill install --user` now prints a migration hint; `--skill-scope user` remains accepted by init, while `--skill-scope project` asks you to install separately.

To upgrade each project's AKE CLI/config, run init with `--dry-run` from the updated source. Differing `.ake/tools`, config, index files or marker blocks are conflicts, not automatically upgraded; review, back up and manually merge or replace only the intended files, then rerun init. Knowledge and candidates remain project-specific.

After init, run everything from inside the target project through the installed copy:

```bash
node .ake/tools/scripts/ake.mjs search "connection pool timeout"
node .ake/tools/scripts/ake.mjs validate
git add .agents docs .ake && git commit -m "chore: install knowledge ops"
```

Commit the installed layout: knowledge and its audit trail are project files, reviewed like code.

## The workflow

1. **Retrieve visibly before you build.** Before the first AKE CLI call in the retrieval stage, tell the user briefly that you are searching AKE knowledge; coalesce consecutive calls into one notice. In Agent Teams, only Lead/owner notifies the user; members report to Lead. Turn the task into keywords (module, technology, symptom, operation), search all four kinds, show category labels, read only hits whose recorded `scope`/`verified` still apply, and report which knowledge you used. A miss means "not found", not "does not exist".
2. **Route by stage; continue without redundant pauses.** A task-before trigger performs retrieval/applicability judgment only; it does not start capture. A task-after trigger assesses whether durable knowledge is worth capturing. Explicit `/ake` follows the stage(s) requested; the automatic completion-phrase route alone requires substantive engineering work, a loaded Skill, and an explicit confirmation such as “tests passed” or “acceptance passed.” Ordinary Q&A does not automatically trigger that route. Within the applicable stage, proceed through its permitted steps without inserting extra “continue?” pauses; only actual reviewer response and user release authorization are real wait gates. Candidate deduplication/creation/review happens only if task-after assessment finds supported, reusable, not-already-covered knowledge. No value → report `AKE · 本次无新增知识`; potentially valuable but insufficient core evidence → do not create a candidate, and report “potential knowledge pending evidence,” the gap, and verification path. Completion confirmation is not publication authorization, and ordinary language cannot guarantee host-side Skill loading/triggering. Before a candidate action, tell the user which result qualifies. Search for an existing owner first; prefer updating it, and report pending candidate IDs/statuses.
3. **Check evidence and obtain an independent review.** Run `candidate check` and inspect structure, scope/evidence, links, target, duplicate hints and verification. Reviewer evidence levels concern relevant core claims: A = strong direct evidence such as source code/change, executed test logs, reproducible results, or before/after comparisons when relevant. B = relevant current-context evidence such as current runtime/system status, actual browser inspection, this Session Agent’s direct verification, user confirmation, or readable configuration/install scripts/system state. B need not be persisted and needs no ID or separate evidence artifact; session observations do not require independent locatable corroboration. C = core claim lacks basic relevant support, evidence mismatches the claim, or available evidence contradicts it. A/B can support; C on a core claim is BLOCK. Missing session IDs, event numbers, standalone evidence files or unrelated topics alone do not lower a level or block. Report outcomes as PASS / PASS WITH LIMITATIONS / BLOCK, mapping to existing CLI verdicts `approve|request-changes|reject`: PASS → approve; PASS WITH LIMITATIONS → approve only when limitations are already explicit in the candidate, otherwise request-changes; BLOCK → request-changes if fixable, reject otherwise. Wait for the independent reviewer’s actual response; dispatch/acceptance or silence is not review. If no independent reviewer is available (including Single Session), say so and pause; author self-review may record the author’s own check but does not substitute for this workflow’s independent review. After request-changes, permit at most one automatic revision and one independent re-review; then pause if unresolved.
4. **Wait for explicit user authorization before publishing.** After a passing review, summarize the candidate and its limitations and wait for the user to authorize publication. Do not call `approve` or `publish` before that authorization. Then use `approve <id> --by <human> --confirm` and `publish <id>`; `--by` is a declaration, not a verified identity. Existing CLI automatic authorization remains available for compatibility but is not the Skill workflow default.

Candidate lifecycle (`draft → submitted → reviewed → approved → published`, with `rejected`/`superseded` branches) and the publish gate are specified in [docs/architecture.md](docs/architecture.md) §6.

### Single session

The Skill workflow does not substitute self-review for an independent review. If no eligible independent reviewer can be used, stop after preparing/checking the candidate and report that review is unavailable; do not authorize or publish. Once an independent reviewer has actually returned a passing result, continue only after explicit user authorization:

```bash
node .ake/tools/scripts/ake.mjs candidate new --kind note \
  --title "…" --target .agents/notes/proposed/process/2026-11-10-….md \
  --author "<agent>" --body /tmp/draft.md
node .ake/tools/scripts/ake.mjs candidate submit C-0001
node .ake/tools/scripts/ake.mjs candidate check C-0001
# Run only after the actual independent review result is received:
node .ake/tools/scripts/ake.mjs review C-0001 --reviewer "<actual-reviewer>" --verdict approve --notes "checked scope, evidence, format, links, target, alternatives and verification"
# Run only after the user explicitly authorizes publication:
node .ake/tools/scripts/ake.mjs approve C-0001 --by "<human>" --confirm
node .ake/tools/scripts/ake.mjs publish C-0001
```

### Agent Teams

The agent that did the task searches and proposes; an eligible member who did not generate the candidate reviews it. The owner waits for the reviewer's actual response (not dispatch acceptance or silence), summarizes the result and any limitations, then waits for explicit user authorization before using the declared human authorization mode and publishing. If no suitable reviewer exists, pause; an author self-review is not a substitute in this Skill workflow. Independent review is a declared-role check, not verified identity — see the limitations.

## Knowledge kinds

| Kind | Directory | Records | Machine layer |
|---|---|---|---|
| Agent Note | `.agents/notes/{proposed,implemented,rejected}/{class}/` | decisions and proposals, with rejected alternatives | official three-line header and path-encoded lifecycle |
| Defensive pattern | `docs/defensive-patterns/` | review rules and defect classes they prevent | `ake:` frontmatter + `**Prevents:**/**Reviewer check:**/**Boundary:**` labels |
| Post-mortem | `docs/postmortem/` | incidents, root causes, guardrails | header + required sections |
| Cookbook | `docs/cookbook/` | verified, repeatable procedures | `ake:` frontmatter + required sections |

One fact has one authoritative home; related knowledge is linked with relative Markdown links; `README.md` files inside the knowledge roots are index pages and are skipped by validation and search. The exact rules are frozen in [docs/architecture.md](docs/architecture.md) §4.

## CLI

| Command | Purpose |
|---|---|
| `ake init [--dir] [--dry-run] [--merge-agents]` | plan/install knowledge layout; append AKE rules to unmarked `AGENTS.md` by default and remind about separate Skill installation |
| `ake search <terms…> [--type] [--limit] [--include-candidates] [--json]` | keyword retrieval with coverage reporting |
| `ake validate [--project] [--path] [--json]` | format, link, id and lifecycle checks |
| `ake candidate new/submit/revise/list/show/check <id>` | candidate lifecycle and drift/similarity report |
| `ake review <id> --reviewer --verdict [--notes]` or `--self-review` | independent review or explicitly identified author self-review, bound to current content |
| `ake approve <id> --confirm` or `--automatic --confirm` | CLI local automatic authorization mode (retained for compatibility; not the AKE Skill workflow default) |
| `ake approve <id> --by <human> --confirm` | declared human authorization after explicit user authorization; identity is not verified |
| `ake publish <id> [--dry-run\|--reconcile]` | fail-closed publication, atomic write, audit log line; `--reconcile` completes the ledger after an unknown result when the target already matches the approved content |
| `ake status` | knowledge counts, pending candidates, unverified entries |

Exit codes: `0` success, `1` validation/gate refusal (with the concrete reason), `2` usage error.

## Limitations

- **Not a security boundary.** In a shared writable workspace, ordinary file and shell tools can still edit formal knowledge directly, and `--by`/`--reviewer` strings are declarations, not verified identities. The publish gate checks only operations that go through the CLI; it does not prevent bypass, and there is no filesystem lock or multi-file transaction. Never report the workflow as mandatory enforcement.
- **Retrieval is lexical.** `ake search` matches tokens deterministically and reports its scope and coverage; it does not perform semantic retrieval, cannot guarantee recall, and does not decide whether knowledge still applies. Scores are ranking hints, not relevance probabilities.
- **The CLI retains a local automatic mode, but the Skill workflow requires user authorization.** AKE's Skill does not treat reviewer approval as publication authorization and does not invoke automatic authorization by default. It waits for explicit user authorization before the declared human mode and publication. The CLI's `--confirm` writes the selected authorization mode; `--by` remains an unverified declaration. Existing automatic mode remains available for compatibility but is not a security control or the documented Skill workflow.
- **Verification scope.** Unit tests and isolation-project integration tests run in CI-like conditions. Real DSH Single-Session and Agent Teams runs are recorded as individual observations, not statistics; retrieval recall, adherence and identity verification remain unverified. See [docs/test-report.md](docs/test-report.md).
- **Not implemented in v0.1**: DSH runtime plugin, MCP server, vector index, background service, web UI, central approval service, bilingual note triplets, the official `archived/` tree.

## Repository layout

```text
AGENTS.md            standing rules for developing AKE itself
src/lib/*.mjs        reusable logic: parsing, validation, search, candidate lifecycle, publish, init
scripts/ake.mjs      CLI entry
skills/ake/SKILL.md
templates/project/   what `ake init` installs
tests/               unit + isolation-project integration tests, fixtures
docs/                architecture, test report, design review, reviews
research/knowledge-ops/   research reports and official format references (evidence)
```

Developing AKE: `npm test`, `npm run check` (tests plus validation of this repository's own knowledge).

## Status

v0.1 MVP: implemented and verified at the levels recorded in [docs/test-report.md](docs/test-report.md). Next-phase suggestions are listed in [docs/architecture.md](docs/architecture.md) §1 non-goals and in the proposed note above; they are not implemented.
