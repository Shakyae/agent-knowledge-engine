# Agent Knowledge Engine (AKE) v0.1

A portable, low-intrusion engineering-knowledge layer for coding agents. Agents retrieve existing project knowledge when relevant, capture reusable results in one of four knowledge kinds, and publish through a bound review/authorization gate. Team workflows use an eligible independent reviewer; Single Session uses an explicitly recorded author self-review. After the review gate, local automatic authorization is the default; neither self-review nor automatic authorization is misrepresented as independent or human.

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

`init` creates knowledge directories, configuration and a self-contained CLI at `.ake/tools/scripts/ake.mjs`; it does not install or inspect Skills. Its output explicitly reminds you to install the `ake` Skill separately; presence does not prove it was loaded. Each project's data stays in that project. Use the Skill's commands from the target project root, so the shared Skill invokes that project's CLI. `init` leaves differing existing files untouched and reports conflicts; it may still create other safe items. An existing unmarked `AGENTS.md` gets the marked trigger block appended by default, preserving all original bytes and remaining idempotent. Existing mismatched/malformed marker blocks remain conflicts and are never overwritten. `--merge-agents` is retained as a compatibility flag.

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
2. **Report and capture after you learn.** Before the first candidate action, tell the user which reusable result will be captured as Agent Note, Defensive Pattern, Postmortem or Cookbook; coalesce same-stage commands and let the Team Lead send one unified notice. If none is warranted, report exactly `AKE · 本次无新增知识`. If it does, first search for the existing owner of that fact. Prefer updating it; a new document is the last resort. Report pending candidate IDs and why they remain unpublished.
3. **Check and review honestly.** Run `candidate check` and inspect structure, scope/evidence, links, target, duplicate hints and verification. Prefer a capable Team reviewer who did not create the candidate. In a Single Session or when no suitable reviewer exists, use explicitly recorded author self-review; never describe it as independent.
4. **Publish locally after the review gate.** Automatic local authorization is the default (`approve <id> --confirm`); it records `mode: automatic`, not human approval. Use `--by <human>` only when a human authorization is explicitly requested. Both paths preserve status, review/approval binding, validation, target drift detection and publish/reconcile gates.

Candidate lifecycle (`draft → submitted → reviewed → approved → published`, with `rejected`/`superseded` branches) and the publish gate are specified in [docs/architecture.md](docs/architecture.md) §6.

### Single session

```bash
node .ake/tools/scripts/ake.mjs candidate new --kind note \
  --title "…" --target .agents/notes/proposed/process/2026-11-10-….md \
  --author "<agent>" --body /tmp/draft.md
node .ake/tools/scripts/ake.mjs candidate submit C-0001
# If no suitable independent reviewer is available: record the actual author self-review.
node .ake/tools/scripts/ake.mjs candidate check C-0001
node .ake/tools/scripts/ake.mjs review C-0001 --self-review --verdict approve --notes "checked scope, evidence, format, links, target, alternatives and verification"
# Default local automatic authorization after self-review:
node .ake/tools/scripts/ake.mjs approve C-0001 --confirm
node .ake/tools/scripts/ake.mjs publish C-0001
```

### Agent Teams

The agent that did the task searches and proposes; an eligible member who did not generate the candidate reviews it; one designated publisher uses the default local automatic authorization and publishes. If no suitable reviewer exists, record the actual author self-review and continue through the same automatic publish gate. Independent review is a declared-role check, not verified identity — see the limitations.

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
| `ake approve <id> --confirm` [default] or `--by <human> --confirm` | default bound local automatic authorization, or explicitly requested human authorization |
| `ake publish <id> [--dry-run\|--reconcile]` | fail-closed publication, atomic write, audit log line; `--reconcile` completes the ledger after an unknown result when the target already matches the approved content |
| `ake status` | knowledge counts, pending candidates, unverified entries |

Exit codes: `0` success, `1` validation/gate refusal (with the concrete reason), `2` usage error.

## Limitations

- **Not a security boundary.** In a shared writable workspace, ordinary file and shell tools can still edit formal knowledge directly, and `--by`/`--reviewer` strings are declarations, not verified identities. The publish gate checks only operations that go through the CLI; it does not prevent bypass, and there is no filesystem lock or multi-file transaction. Never report the workflow as mandatory enforcement.
- **Retrieval is lexical.** `ake search` matches tokens deterministically and reports its scope and coverage; it does not perform semantic retrieval, cannot guarantee recall, and does not decide whether knowledge still applies. Scores are ranking hints, not relevance probabilities.
- **Automatic publishing is local and gate-bound.** After the required review (independent in Teams; explicitly identified self-review in Single Session), local automatic authorization is the default; `--confirm` is the CLI write confirmation, not a request for an extra human reviewer/approver. It records automatic authorization and does not claim human approval. It does not weaken bound review, validation, drift or recovery gates. Historical preconditions remain in `.agents/notes/proposed/process/2026-11-09-team-auto-publish-preconditions.md` as prior design context.
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
