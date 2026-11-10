# Agent Knowledge Engine (AKE) — Architecture & v0.1 Contract

Status: v0.1 **frozen** interface, amended after independent design review (see [design-review.md](design-review.md) and the adjudications recorded in `.agents/notes/implemented/process/`). User-requested amendment: the Skill is named `ake`, supports project and user scope, and user installation is a separate explicit operation; see [README installation and migration](../README.md#updates-and-migration). Other deviations must be proposed to the Lead before coding.

## 1. Purpose and non-goals

AKE makes a **project's engineering knowledge** discoverable, reusable, capturable and reviewable by coding agents, without a runtime service.

v0.1 delivers: a project knowledge layout compatible with the official DSH knowledge conventions, one `ake` Skill, one small dependency-free Node CLI, a conservative project initializer, and automated + isolation-project tests.

Explicit non-goals (do not build in v0.1): DSH runtime plugin, MCP server, vector index, background memory service, web UI, approval server, automatic publishing without a human authorization record, cross-repo sync, bilingual note triplets, the `archived/` tree, `##`-section semantic judgement.

**Boundary statement (authoritative; must appear in README and test report):**
AKE is a *process and tooling* layer, not a security boundary. On a shared `workspace-write` filesystem any agent can edit formal knowledge files directly with ordinary file/shell tools. Skill/AGENTS rules are soft constraints. `ake` enforces ordering, hashing, format and observed-drift checks only over paths it writes; it cannot prevent bypass, and it cannot verify that `--reviewer`/`--by` identities are real or independent. Never describe approval as mandatory security enforcement. See §5 boundary claims (P-PROMPT / P-CHECK / P-UNVERIFIED).

## 2. Repository layout (this repo)

```text
AGENTS.md              # standing rules for developing AKE itself
README.md              # product, install, init, use, limitations
package.json           # scripts: test, check; no runtime dependencies
src/lib/*.mjs          # parsing, search, validation, candidate lifecycle, publish, init (ESM)
scripts/ake.mjs        # CLI entry (imports ../src/lib/*.mjs)
skills/ake/SKILL.md
templates/project/     # installed into target projects by `ake init`
tests/unit/ tests/integration/ tests/fixtures/
docs/architecture.md docs/test-report.md docs/design-review.md docs/reviews/
research/knowledge-ops/          # reports + official format references (evidence)
```

**Module extension rule:** every implemented module uses the `.mjs` extension — in this repo *and* in the copy installed into target projects. Reason: a copied `.js` file inherits the target project's `package.json` type (or CommonJS default) and would fail to `import`. `.mjs` is ESM regardless of the target's package boundary, and it lets AKE run in a target repo without modifying that repo's `package.json`. Node >= 20, ESM, no third-party dependencies, `node:test`, cross-platform, LF.

Own repo dogfoods AKE: `.agents/notes/`, `docs/defensive-patterns/`, `docs/cookbook/`, `.ake/config.json` exist and `npm run check` validates them.

## 3. Target project layout (installed by `ake init`)

```text
<target>/
├── .agents/notes/{proposed,implemented,rejected}/{class}/  # official lifecycle + class tree
├── .agents/skills/ake/SKILL.md                   # optional separate Skill installation
├── docs/defensive-patterns/  docs/postmortem/  docs/cookbook/
├── .ake/
│   ├── config.json          # knowledge roots + version
│   ├── candidates/          # C-*.md candidate records (NOT formal knowledge)
│   ├── publish-log.jsonl    # append-only publish audit trail
│   ├── tools/{scripts/ake.mjs, src/lib/*.mjs}   # self-contained copy of this CLI
│   └── AGENTS-fragment.md   # merge fragment for existing AGENTS.md
└── AGENTS.md                # created when absent; never silently modified when present
```

`ake init` never overwrites an existing file, never deletes, never edits `AGENTS.md` without an explicit flag.

## 4. Knowledge document kinds and machine-checkable adaptation

Official formats are the human authority. AKE's machine layer must not contradict them:

- **Human authority** = the formal Markdown body plus the directory that encodes type/lifecycle.
- **Governance authority** = `.ake/` candidate state, review and approval records (never overrides formal document meaning).
- The optional `ake:` frontmatter block is a machine aid; if it disagrees with the body/path, the body/path wins and the validator reports an error.

### 4.1 Frontmatter: which kinds carry it

| Kind | Frontmatter | Status authority |
|---|---|---|
| Agent Note | **not allowed** (official header must be the first three lines) | `Status:` header, cross-checked against lifecycle folder |
| Postmortem | optional `ake:` block | `Status:` header |
| Defensive pattern | required `ake:` block incl. `status` | frontmatter |
| Cookbook | required `ake:` block incl. `status` | frontmatter |

For defensive-patterns and cookbooks:

```yaml
---
ake:
  type: defensive-pattern | cookbook
  id: DP-<slug> | CB-<slug>          # unique across all knowledge roots
  status: active | draft | deprecated
  created: YYYY-MM-DD
  updated: YYYY-MM-DD                # optional
  scope: ["src/**"]                  # >=1 applicability entry
  evidence: ["tests/x.test.mjs"]     # >=1 traceable evidence entry
  verified: YYYY-MM-DD | pending     # optional
---
```

Postmortems may carry the same block minus `status` (their `Status:` header owns status). Notes carry no frontmatter; their `scope`/`evidence` are reported as `unknown` unless derivable from the body, and are never invented.

Missing metadata is reported as `unknown` — never fabricated, and not an error for notes/postmortems. `type` must match the directory; `id` unique; dates ISO; `scope`/`evidence` non-empty strings.

### 4.2 Agent Notes (`.agents/notes/{proposed,implemented,rejected}/{class}/yyyy-mm-dd-<slug>.md`)

Class ∈ closed set `feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing` (official). File format, verbatim:

```markdown
# Agent Note: <title>

Status: proposed | implemented | rejected — <one-line why>

## Problem
...
## Proposal | ## Decision
## Alternatives considered      (mandatory)
## Acceptance criteria | ## Risks  (proposed)
## Consequences               (implemented)
```

Gate: first three lines exactly as above with a blank line after `Status:`; `Status:` agrees with lifecycle folder; filename date valid `YYYY-MM-DD` with ASCII slug; `## Problem` is the body's first `##` section and non-empty; `## Alternatives considered` non-empty; `proposed` needs `## Proposal`, `## Acceptance criteria`, `## Risks`; `implemented` needs `## Decision`, `## Consequences` and MUST NOT contain `## Proposal`, `## Plan`, `## Migration plan`, `## Acceptance criteria`; `rejected` needs `## Proposal` and a non-empty reason after the em dash. Fenced code blocks are never counted as sections. Do not force this lifecycle onto other kinds; do not add a centralized note index.

### 4.3 Defensive patterns (`docs/defensive-patterns/<topic>.md`)

Official rule semantics with explicit labels so they are machine-checkable:

```markdown
# <Topic> defensive patterns

## <Rule, stated as a requirement>

<1-3 sentences: the rule.>

**Prevents:** <the defect class>.
**Reviewer check:** <the objective condition a reviewer judges>.
**Boundary:** <where the rule stops / who approves an exception>.

```ts
// correct form
```
```ts
// wrong form — how it fails
```
```

Gate: >=1 `##` rule; each rule has non-empty `**Prevents:**`, `**Reviewer check:**`, `**Boundary:**`. Structure is all the machine checks; it does not prove the examples correct or the boundary reasonable. A file with multiple rules fails per rule, naming the rule and line.

### 4.4 Postmortem (`docs/postmortem/`)

```markdown
# Post-mortem NNNN: <title>

Status: resolved | open | mitigated (<detail>) | <free-form short state>

## Executive summary
## Summary
## Impact
## Timeline
## Root cause [optional suffix]
## Guardrails [optional suffix]
```

Gate: H1 matches `# Post-mortem \d{4}: <non-empty title>`; non-empty `Status:` line (no note enumeration imposed; free-form, meaning explained in the body); non-empty `Executive summary`, `Summary`, `Impact`, `Timeline`, plus non-empty sections starting with `Root cause` and `Guardrails` (suffixes allowed for compatibility with official samples). A `Status:` beginning with `resolved` requires >=1 markdown link inside `## Guardrails`. Never infer that an incident is actually resolved.

### 4.5 Cookbook (`docs/cookbook/<recipe>.md`)

```markdown
# <Recipe name>

## When to use
## Prerequisites        (optional)
## Steps
1. ...
## Verification
## Related              (optional)
```

Gate: non-empty H1; `## When to use` and `## Verification` non-empty; `## Steps` with >=1 numbered item; `ake.status` required. Steps-shaped recipes are the MVP convention, not a claim that all official cookbook pages are step lists.

### 4.6 Index files

`README.md` directly in a knowledge root or lifecycle/class subfolder is an **index page**: `validate` skips it, `search` excludes it. Dotfiles, `.gitkeep` and non-`.md` files are ignored. Every other `.md` under a root is a knowledge document and must comply. Index pages are never publish targets.

### 4.7 Link and identity rules (all kinds)

Relative markdown links must resolve to an existing path inside the repo (error otherwise); anchors, absolute URLs and `mailto:` are skipped; ids unique; filenames ASCII; frontmatter parse errors are errors unless documented as optional for that kind.

### 4.8 Project resolution and config

`.ake/config.json` (created by `init`, committed):

```json
{ "version": "0.1.0",
  "knowledgeRoots": { "note": ".agents/notes", "defensive-pattern": "docs/defensive-patterns",
                      "postmortem": "docs/postmortem", "cookbook": "docs/cookbook" },
  "candidatesDir": ".ake/candidates", "publishLog": ".ake/publish-log.jsonl" }
```

Every command resolves the project root as: explicit `--project <dir>` if given, else the nearest ancestor of CWD whose `.git` is a valid Git work tree (`git -C <dir> rev-parse --is-inside-work-tree` succeeds — this covers linked worktrees where `.git` is a file), else error `not a AKE project: no .git repository found`. Nested repositories resolve to the nearest one. Roots are repo-relative; resolved paths outside the project root are rejected.

## 5. Retrieval (`ake search`)

Input: free-text query (module names, technology, symptom, operation). Sources: configured roots + optional `.ake/candidates`.

- Tokenize: lowercase; split on non-alphanumeric; CJK runs matched as substrings. Score: title 6, filename 4, frontmatter fields 3, heading 2, body 1 (max 3 counted hits per term per doc). Deterministic: ties break by path ascending. Document the rule in `--help`; never present the score as relevance probability.
- Every hit carries: repo-relative `path`, `type`, `status` (`unknown` if not recorded), `scope` (`unknown` if not recorded), `verified`, `relevance`, and `snippets` (>=1, each with `line` and the original text).
- Top-level output: `query` (terms), `searchedRoots`, `coverage` (`complete` | `incomplete`), `coverageReasons[]`, `truncated` (bool), `results[]`.
- Zero hits: `No matching knowledge found in the searched scope. This means "not found", not "does not exist".` Exit 0.
- A root directory that does not exist is reported as `root not installed (treated as confirmed empty)` and does **not** by itself make coverage incomplete. Read/permission/parse failures, skipped unreadable files, or truncated results **do** set `coverage: incomplete` with reasons, even when other hits exist. Never treat a permission error as "no knowledge".
- Applicability is displayed, never decided: the caller reads the hit and judges. No hard freshness cutoff is encoded; `verified: pending` or `unknown` is labelled, not hidden.
- Options: `--type`, `--limit` (default 10), `--include-candidates` (hits are then labelled `candidate` with governance status), `--json`.

## 6. Candidate lifecycle and publish gate

Store: `.ake/candidates/<id>-<slug>.md`, ids `C-0001`… allocated from max existing + 1.

```markdown
---
akeCandidate:
  id: C-0001
  revision: 1
  kind: note | defensive-pattern | postmortem | cookbook
  title: ...
  author: <agent identity string>
  created: YYYY-MM-DD
  status: draft | submitted | reviewed | approved | published | rejected | superseded
  target: .agents/notes/proposed/process/2026-11-09-foo.md
  operation: create | update
  targetHash: "<sha256 of raw target bytes>" | "absent"
  contentHash: "<sha256 of body bytes as stored>"
  reviews: [{ reviewer, verdict, contentHash, target, targetHash, operation, at, notes }]
  approval: null | { by, at, contentHash, target, targetHash, operation }
  publication: null | { at, contentHash, target, previousTargetHash }
  supersededBy: null | C-0002
---
<!-- body: the exact markdown file that will be published, including any frontmatter -->
```

Binding set = `{contentHash, target, targetHash, operation}`. `contentHash` = SHA-256 of the exact body bytes the CLI stores and will write (CLI normalizes EOL to LF once at store time and records that fact). `targetHash` = SHA-256 of the raw target file bytes; the sentinel `"absent"` represents a missing target (never the hash of an empty file).

Semantics:

1. `candidate new` → `draft` with `operation` derived from `target` existence (create/update). `candidate submit` → `submitted`; requires: non-empty body; body passes the full document gate for its `kind` (except that target/lifecycle legality is checked separately); target is inside the configured root for `kind` and legal for the kind (notes: lifecycle folder must match body `Status:` after publish, and class must be in the closed set).
2. `candidate revise <id> --body <file>` → new draft revision of the same candidate id: appends the old revision record to `.ake/candidates/<id>.revisions/`? **No** — v0.1 keeps history simple: it increments `revision`, resets state to `draft`, clears `reviews`/`approval` (they were bound to the old bytes) and keeps one file. If a candidate was already `published`, revising it is refused — publish a new candidate instead.
3. `review --reviewer R --verdict approve|request-changes|reject` — requires `submitted`/`reviewed`; `R` must differ from `author` (else exit 1 `a candidate author cannot review its own candidate`); records `{reviewer, verdict, contentHash, target, targetHash, operation, at, notes}`; a non-empty `notes` or evidence reference is required for `approve` and `reject`. Status recompute: any `approve` bound to the current binding set → `reviewed`; latest bound verdict `reject` → `rejected` (reason required); `request-changes` stays `submitted`. Entries bound to a stale binding set are reported as stale and ignored.
4. `approve --by <human> [--confirm]` — requires `reviewed`; records `{by, at, contentHash, target, targetHash, operation}`. `--by` is a declaration, not a verified human signature. Without `--confirm`, print what would be authorized and write nothing.
5. `publish [--dry-run]` fail-closed requires ALL of: status `approved`; approval bound to the current binding set; >=1 approve review bound to the current binding set with reviewer ≠ author; recomputed body hash equal to stored `contentHash`; target inside a configured root and legal for the kind; target hash equal to `targetHash` (missing target when `"absent"`, or existing content when a hash) — any drift refuses with `target changed since candidate creation; re-review required`; body passes full document validation; resulting document id does not collide with an existing document id; no unresolved conflict reported by `candidate check`. On success: write the body with a temp file + `rename` (atomic within the directory), re-read and verify the written hash, set `published` + `publication`, append one JSON line to `.ake/publish-log.jsonl` `{at, id, revision, target, contentHash, previousTargetHash}`. The CLI never runs `git commit`; the publisher decides.
6. Crash window: before the atomic write the CLI persists an in-flight marker (`pendingPublication: {at, contentHash, previousTargetHash}`) in the candidate record. If the target write succeeds but the state/log update then fails, the command exits 1 with `publish result unknown: target written, ledger not updated; reconcile manually` and leaves the marker in place. Never auto-replay, never overwrite the target to "retry". Any later plain `publish` refuses while the marker exists, including the case where the target bytes happen to equal the stored `targetHash` (a bytes-identical update makes drift undetectable). Recovery is explicit: `publish <id> --reconcile` completes the ledger only when the target's current bytes hash equals the candidate `contentHash`; otherwise it refuses and keeps the marker.
7. No multi-file transaction and no TOCTOU-free exclusivity is claimed: hash re-checks immediately before rename detect *observed* drift, but a writer that changes the target after the check is not prevented. A single designated publisher is a collaboration convention (§1 boundary statement).
8. `candidate check <id>` reports: body validation errors, binding drift (content/target/operation), stale vs bound reviews, id collision, and an advisory similarity report (same normalized title or >= 60% token overlap with an existing doc). Advisory only; publishing still requires the gate in (5).

## 7. `ake init` (conservative, idempotent)

Preconditions: target resolves to a valid Git work tree (§4.8); otherwise exit 1 with a clear message and **zero writes**. No `git init`.

Plan first, then apply. Each item gets exactly one outcome:

- `created` — absent and safe; written.
- `identical` — exists, byte-identical; not rewritten.
- `skip` — intentionally not processed (e.g. a directory already present, `AGENTS.md` present without `--merge-agents`); reason reported.
- `conflict` — exists with different bytes, wrong type, unreadable or unsafe to write; left untouched, reported with path and source.

Exit 1 if any conflict; 0 otherwise. Mixed outcomes still create safe missing items. `--dry-run` prints the plan only. Never overwrite, merge, upgrade, delete, auto-commit, or modify `package.json`; never write outside the project root; refuse paths that resolve through symlinks escaping the root.

Item set (templates contain knowledge index pages and the `AGENTS.md` block; the config is generated from code). Skill installation is separate and uses `skills/ake/` as its source:

- four knowledge roots with the templates' index READMEs;
- `.ake/config.json`, generated from the code's defaults (not a template copy);
- `.ake/tools/scripts/ake.mjs` + `.ake/tools/src/lib/*.mjs` (byte-identical `.mjs` copies);
- `.ake/candidates/` directory (the publish log is created on first publish, not as an empty file);
- `AGENTS.md` handling below (template file `templates/project/AGENTS.md` is the marker-wrapped block; `.ake/AGENTS-fragment.md` receives the same block for manual merging).

`AGENTS.md`:
- absent → `created` from the template, whose content is wrapped in `<!-- ake:begin -->`…`<!-- ake:end -->` so a later explicit merge is well-defined.
- present and contains exactly one complete matching marker block → `identical`.
- present without markers → `skip`, never modified; `.ake/AGENTS-fragment.md` is written (`created`/`identical`) so the user can merge manually; the path is reported.
- present with malformed/unpaired/duplicate markers → `conflict`, unmodified.
- `--merge-agents` → appends the marker block to an existing unmarked `AGENTS.md`, preserving every original byte; re-running is `identical`, never duplicate-append. It does not rewrite an existing block.

Skill discovery statement: `<projectRoot>/.agents/skills/ake/SKILL.md` matches the DSH filesystem skill provider's project root (`<projectRoot>/.agents/skills`, direct `name/SKILL.md` bundle, frontmatter `name`/`description`). Path presence is not proof of loading: same-name shadowing or a disabled provider still prevent it (P-UNVERIFIED-2).

## 8. Verification levels (what the test report may claim)

`docs/test-report.md` must separate:
1. unit tests passing (`node:test`);
2. isolation-project integration tests passing (temporary Git repos, real `git init`, real CLI subprocesses);
3. real DSH Single-Session runs (fresh agent session, no shared history; record searches, hits, applicability judgement, application);
4. real DSH Agent Teams runs (independent reviewer, designated publisher, withheld human authorization);
5. unverified behaviours — never counted as passing.

Boundary claims to be cited with actual results, never as design assertions:

- **P-PROMPT-1** (prompt rule): AGENTS/Skill ask for pre-task retrieval, candidate capture, independent review, explicit human authorization, single-publisher serialization. Soft; may be unloaded, truncated or ignored.
- **P-PROMPT-2** (prompt rule): in a shared `workspace-write` workspace, ordinary write/edit/shell can still edit formal knowledge directly; "single publisher" is a convention, not a lock; published knowledge text must not be treated as high-priority instructions.
- **P-CHECK-1** (program-checkable): for operations that go through the CLI, structure, record completeness, declared-role inequality, state, authorization scope and bound hashes are checked; failures are refused per §6.
- **P-CHECK-2** (program-checkable): paths, target snapshots, observed concurrent change and init conflicts are checked; no exclusivity against writes that happen after the check, no multi-file transaction, no other write entry point.
- **P-UNVERIFIED-1** (unverified assumption): recorded reviewer/approver identifiers correspond to different, qualified, non-generating real humans. The CLI offers no trusted identity verification.
- **P-UNVERIFIED-2** (unverified assumption): the current DSH profile enables the filesystem skill provider and the installed project skill is loaded, not shadowed.
- **P-UNVERIFIED-3** (unverified assumption): real-task retrieval recall, applicability judgement, adherence rate, redaction, cost and cross-task reuse are acceptable.
- **P-UNVERIFIED-4** (unverified assumption): target Node versions, package boundaries, platforms, Git worktrees and crash recovery behave as designed.

## 9. Acceptance criteria for v0.1

1. `npm test` green from a clean checkout; `node scripts/ake.mjs validate --project .` green on this repo.
2. Fresh temp Git project: `ake init` creates the layout, installs the skill and `.ake/tools`, creates `AGENTS.md` once, and a second run reports all `identical`/`skip` and writes nothing.
3. `ake init` on a project with a pre-existing `AGENTS.md` and knowledge directories reports `skip`/`conflict`, changes nothing, and exits 1 when conflicts exist.
4. In an initialized project: draft → submit → revise (invalidating old approvals) → review by a different identity → approve by a human declaration → publish; and publish refusals for: no approval, self-review, stale binding, target drift, id collision, illegal kind/target path, invalid document.
5. Format gate rejects each of: missing required frontmatter (dp/cookbook), note header/folder mismatch, missing mandatory section, dangling relative link, duplicate id, malformed marker block.
6. Evolution scenario: a candidate that partially supersedes an existing note reports the overlap and names the existing document as the update target instead of proposing a parallel duplicate.
7. CLI copied into the target (`.ake/tools/scripts/ake.mjs`) runs `search`/`validate` from a different CWD in that target with no AKE-repo dependency, in a target whose `package.json` is absent or CommonJS.
