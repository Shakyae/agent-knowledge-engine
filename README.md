# Agent Knowledge Engine (PKO) v0.1

A portable, low-intrusion engineering-knowledge layer for coding agents. Agents retrieve existing project knowledge before a task, capture new knowledge where it is discovered, and promote it to formal knowledge only after an independent review and an explicit human authorization.

There is no server, database or plugin: knowledge is Markdown in the project's Git repository, behaviour is described by a Skill plus `AGENTS.md`, and a dependency-free Node CLI (`kno`) performs the format checks, keyword retrieval, candidate lifecycle and publish gate.

## What it solves

Agents start every task in a new context. Durable, project-specific knowledge — why a design is what it is, which defect classes keep reappearing, what actually happened during an incident, which procedure was verified — otherwise has to be rediscovered or is lost.

PKO gives that knowledge:

- **a place**: four knowledge kinds adapted from the official DSH conventions,
- **a way in**: `kno search` plus a Skill that defines when and how to search,
- **a way to grow**: candidates captured where the experience emerged, with evidence and applicability recorded,
- **a way to stay honest**: an independent review requirement, a hash-bound publish gate and a declared human authorization,
- **an honest boundary**: it is a process and tooling layer, not a security mechanism (see [Limitations](#limitations)).

## Requirements

- Node.js >= 20 (no third-party dependencies).
- Git (initialization refuses to run outside a valid Git work tree).

## Use PKO in a project (v0.1)

```bash
# from this repository (or any copy of it)
node scripts/kno.mjs init --dir /path/to/your/project --dry-run   # review the plan first
node scripts/kno.mjs init --dir /path/to/your/project
```

`init` creates the knowledge directories, index pages, the Knowledge Ops Skill at `.agents/skills/knowledge-ops/SKILL.md`, and a self-contained CLI copy at `.pko/tools/scripts/kno.mjs`. It never overwrites an existing file; conflicts are reported and the command exits non-zero. `AGENTS.md` is created only when absent; if it already exists, PKO writes `.pko/AGENTS-fragment.md` for you to merge, or appends a marked block when you pass `--merge-agents`.

After init, run everything from inside the target project through the installed copy:

```bash
node .pko/tools/scripts/kno.mjs search "connection pool timeout"
node .pko/tools/scripts/kno.mjs validate
git add .agents docs .pko && git commit -m "chore: install knowledge ops"
```

Commit the installed layout: knowledge and its audit trail are project files, reviewed like code.

## The workflow

1. **Retrieve before you build.** Turn the task into keywords (module, technology, symptom, operation), search all four kinds, read only the hits whose recorded `scope`/`verified` still apply, and say in your task summary which knowledge you used. A miss means "not found", not "does not exist".
2. **Capture after you learn.** If a durable decision, a verified procedure, a defect class or an incident with a reusable lesson emerged, first search for the existing owner of that fact. Prefer updating it; a new document is the last resort.
3. **Review independently.** A candidate's author cannot review their own candidate. In a single session that means a human reviewer; in Agent Teams it means a different member with the ability to check the evidence.
4. **Publish centrally, with authorization.** One designated publisher runs `kno publish` after a human explicitly approves. The CLI refuses if the candidate body, the target path or the target file changed since the review.

Candidate lifecycle (`draft → submitted → reviewed → approved → published`, with `rejected`/`superseded` branches) and the publish gate are specified in [docs/architecture.md](docs/architecture.md) §6.

### Single session

```bash
node .pko/tools/scripts/kno.mjs candidate new --kind note \
  --title "…" --target .agents/notes/proposed/process/2026-11-10-….md \
  --author "<agent>" --body /tmp/draft.md
node .pko/tools/scripts/kno.mjs candidate submit C-0001
node .pko/tools/scripts/kno.mjs review C-0001 --reviewer "<human or other agent>" --verdict approve --notes "checked evidence"
node .pko/tools/scripts/kno.mjs approve C-0001 --by "<human>" --confirm
node .pko/tools/scripts/kno.mjs publish C-0001
```

### Agent Teams

The same commands, with the work split by capability rather than by member name: the agent that did the task searches and proposes, a member that did not generate the candidate reviews it, and one designated publisher runs the publish step after the human authorization. Independent review is a declared-role check, not verified identity — see the limitations.

## Knowledge kinds

| Kind | Directory | Records | Machine layer |
|---|---|---|---|
| Agent Note | `.agents/notes/{proposed,implemented,rejected}/{class}/` | decisions and proposals, with rejected alternatives | official three-line header and path-encoded lifecycle |
| Defensive pattern | `docs/defensive-patterns/` | review rules and defect classes they prevent | `pko:` frontmatter + `**Prevents:**/**Reviewer check:**/**Boundary:**` labels |
| Post-mortem | `docs/postmortem/` | incidents, root causes, guardrails | header + required sections |
| Cookbook | `docs/cookbook/` | verified, repeatable procedures | `pko:` frontmatter + required sections |

One fact has one authoritative home; related knowledge is linked with relative Markdown links; `README.md` files inside the knowledge roots are index pages and are skipped by validation and search. The exact rules are frozen in [docs/architecture.md](docs/architecture.md) §4.

## CLI

| Command | Purpose |
|---|---|
| `kno init [--dir] [--dry-run] [--merge-agents]` | plan and install the knowledge layout |
| `kno search <terms…> [--type] [--limit] [--include-candidates] [--json]` | keyword retrieval with coverage reporting |
| `kno validate [--project] [--path] [--json]` | format, link, id and lifecycle checks |
| `kno candidate new/submit/revise/list/show/check <id>` | candidate lifecycle and drift/similarity report |
| `kno review <id> --reviewer --verdict [--notes]` | independent review record (author self-review refused) |
| `kno approve <id> --by <human> --confirm` | declared human authorization bound to the current content |
| `kno publish <id> [--dry-run\|--reconcile]` | fail-closed publication, atomic write, audit log line; `--reconcile` completes the ledger after an unknown result when the target already matches the approved content |
| `kno status` | knowledge counts, pending candidates, unverified entries |

Exit codes: `0` success, `1` validation/gate refusal (with the concrete reason), `2` usage error.

## Limitations

- **Not a security boundary.** In a shared writable workspace, ordinary file and shell tools can still edit formal knowledge directly, and `--by`/`--reviewer` strings are declarations, not verified identities. The publish gate checks only operations that go through the CLI; it does not prevent bypass, and there is no filesystem lock or multi-file transaction. Never report the workflow as mandatory enforcement.
- **Retrieval is lexical.** `kno search` matches tokens deterministically and reports its scope and coverage; it does not perform semantic retrieval, cannot guarantee recall, and does not decide whether knowledge still applies. Scores are ranking hints, not relevance probabilities.
- **No automatic publishing.** Independent review plus an explicit human authorization remain required in v0.1; the preconditions for changing that are recorded in `.agents/notes/proposed/process/2026-11-09-team-auto-publish-preconditions.md`.
- **Verification scope.** Unit tests and isolation-project integration tests run in CI-like conditions. Real DSH Single-Session and Agent Teams runs are recorded as individual observations, not statistics; retrieval recall, adherence and identity verification remain unverified. See [docs/test-report.md](docs/test-report.md).
- **Not implemented in v0.1**: DSH runtime plugin, MCP server, vector index, background service, web UI, central approval service, bilingual note triplets, the official `archived/` tree.

## Repository layout

```text
AGENTS.md            standing rules for developing PKO itself
src/lib/*.mjs        reusable logic: parsing, validation, search, candidate lifecycle, publish, init
scripts/kno.mjs      CLI entry
skills/knowledge-ops/SKILL.md
templates/project/   what `kno init` installs
tests/               unit + isolation-project integration tests, fixtures
docs/                architecture, test report, design review, reviews
research/knowledge-ops/   research reports and official format references (evidence)
```

Developing PKO: `npm test`, `npm run check` (tests plus validation of this repository's own knowledge).

## Status

v0.1 MVP: implemented and verified at the levels recorded in [docs/test-report.md](docs/test-report.md). Next-phase suggestions are listed in [docs/architecture.md](docs/architecture.md) §1 non-goals and in the proposed note above; they are not implemented.
