# Agent Knowledge Engine (AKE) — Architecture & v0.1 Contract

Status: v0.1 baseline interface, amended by explicit user/Lead authorization for idempotent AGENTS trigger merging, visible Skill retrieval/capture notifications, four-kind CLI reporting, self-review/automatic-authorization CLI compatibility, offline Skill-distributed initialization resources, and (2026-11-14) user-confirmed completion routing with independent review and explicit user authorization before Skill-driven publication. (2026-11-14) User-authorized scope for installation-status reporting and deterministic Skill update: preserve existing status statistics while adding installation information; use the official GitHub source and migrate a prior local installation on first update; never update the source checkout. Earlier design reviews remain historical; see [design-review.md](design-review.md) and adjudications in `.agents/notes/implemented/process/`. The Skill is named `ake`, supports project and user scope, and installation remains a separate explicit operation; see [README installation and migration](../README.md#updates-and-migration).

## 1. Purpose and non-goals

AKE makes a **project's engineering knowledge** discoverable, reusable, capturable and reviewable by coding agents, without a runtime service.

v0.1 delivers: a project knowledge layout compatible with the official DSH knowledge conventions, one `ake` Skill, one small dependency-free Node CLI, a conservative project initializer, and automated + isolation-project tests.

Explicit non-goals (do not build in v0.1): DSH runtime plugin, MCP server, vector index, background memory service, web UI, approval server, publishing outside an explicit CLI operation or without a bound authorization record, cross-repo sync, bilingual note triplets, the `archived/` tree, `##`-section semantic judgement.

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
skills/ake/bootstrap.mjs + resources/ake-source/  # offline Skill-distributed init source
scripts/sync-skill-bundle.mjs  # reproducible bundle generator/checker
templates/project/     # installed into target projects by `ake init`
tests/unit/ tests/integration/ tests/fixtures/
docs/architecture.md docs/test-report.md docs/design-review.md docs/reviews/
research/knowledge-ops/          # reports + official format references (evidence)
```

**Module extension rule:** every implemented module uses the `.mjs` extension — in this repo *and* in the copy installed into target projects. Reason: a copied `.js` file inherits the target project's `package.json` type (or CommonJS default) and would fail to `import`. `.mjs` is ESM regardless of the target's package boundary, and it lets AKE run in a target repo without modifying that repo's `package.json`. AKE host Node >= 22.20.0, ESM, no third-party runtime dependencies, `node:test`, cross-platform, LF. This does not change a target application's own Node version declaration; initialization leaves it untouched.

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

`ake init` never overwrites a differing existing file or deletes files. It appends the trigger block to an existing unmarked `AGENTS.md` by default, preserving its original bytes; marked conflicts are not modified.

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

Project resolution sanitizes inherited `GIT_*` environment variables before Git probes. Without `--project`, determine the nearest valid Git work-tree root (including linked worktrees) and walk from CWD upward only through that root. Select the nearest ancestor with a complete, valid `.ake/config.json`. A present but malformed, incomplete, or unsafe `.ake` marker (including symlink/path escape) is an error; never skip it to use a parent AKE project. If no marker exists anywhere up to the Git root, retain the Git root with default configuration. A missing config at the Git root (including an empty root `.ake/` directory) also keeps the existing default-config fallback; an incomplete nested `.ake/` marker refuses parent fallback. Explicit `--project <dir>` is canonicalized and used exactly; it must be inside a valid Git work tree but is not redirected to an ancestor AKE project. If that exact directory has no config (including an absent `.ake/` or an empty `.ake/` created by earlier operations), existing default-config behavior is preserved; this keeps explicit `candidate new` → subsequent explicit command working without silently moving the project. A malformed or unsafe config/marker fails closed. Config retains `loadConfig`'s partial-configuration compatibility: omitted `version`, `knowledgeRoots`, `candidatesDir` or `publishLog` values inherit defaults, and `knowledgeRoots` may override only a subset. A present config must be a JSON object; supplied fields must have the expected types. Validate every effective path after merging, including inherited defaults on partial config and no-config fallback, so no default or custom root/candidate/log path can escape through `..` or symlinks. This supports AKE projects in subdirectories of an existing repository without creating a nested Git repository or silently operating on the parent project. Nested repositories resolve within the nearest Git work tree; roots are relative to the selected AKE project, not necessarily the Git root.

## 5. Retrieval (`ake search`)

Input: free-text query (module names, technology, symptom, operation). Sources: configured roots + optional `.ake/candidates`.

- Tokenize: lowercase; split on non-alphanumeric; CJK runs matched as substrings. Score: title 6, filename 4, frontmatter fields 3, heading 2, body 1 (max 3 counted hits per term per doc). Deterministic: ties break by path ascending. Document the rule in `--help`; never present the score as relevance probability.
- Every hit carries: repo-relative `path`, `type`, `status` (`unknown` if not recorded), `scope` (`unknown` if not recorded), `verified`, `relevance`, and `snippets` (>=1, each with `line` and the original text).
- Top-level output: `query` (terms), `filters` (`type`/`status`, null when not supplied), `searchedRoots`, `coverage` (`complete` | `incomplete`), `coverageReasons[]`, `truncated` (bool), `results[]`.
- Zero hits without filters and with complete coverage: `No matching knowledge found in the searched scope. This means "not found", not "does not exist".` With active `--type`/`--status`, the CLI echoes exact filters and roots and says no result matched that requested scope; JSON includes the same filters and roots. Exit 0.
- A root directory that does not exist is reported as `root not installed (treated as confirmed empty)` and does **not** by itself make coverage incomplete; text labels this as a `coverage note`, not `coverage incomplete`. Read/permission/parse failures, skipped unreadable files, or truncated results **do** set `coverage: incomplete` with reasons, even when other hits exist. Never treat a permission error as "no knowledge".
- Applicability is displayed, never decided: the caller reads the hit and judges. No hard freshness cutoff is encoded; `verified: pending` or `unknown` is labelled, not hidden.
- Options: `--type` (exact kind), `--status` (exact reported status; composable with type), `--limit` (default 10), `--budget-bytes N`, `--include-candidates` (hits are then labelled `candidate` with governance status), `--json`. Status authority follows each kind: Agent Note and Postmortem use their body `Status:` line (Postmortem preserves the full free-form line); Defensive Pattern and Cookbook use `ake.status`; candidate uses candidate governance status. Missing status is `unknown`, and `--status unknown` matches only that value. `--budget-bytes` is optional and defaults to unlimited for compatibility. It bounds only the ordered `results` payload: the UTF-8 byte count is the sum of each selected hit's `JSON.stringify(hit)` bytes plus inter-hit commas; enclosing array brackets, top-level query/filters/roots/coverage diagnostics, and text/JSON CLI framing are excluded. Search removes lowest-ranked trailing hits until the payload fits. If a single hit cannot fit, it returns an empty `results` array with `truncated: true`, `coverage: incomplete`, and an explicit reason; no top-level structure or diagnostic is silently removed. Therefore it is not a hard cap on stdout or the whole JSON document. The text CLI reports the same incomplete-coverage reason; it does not claim a stdout byte ceiling.

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
  reviews: [{ reviewer, mode: independent | self, verdict, contentHash, target, targetHash, operation, at, notes }]
  approval: null | { by, mode: automatic | human, at, contentHash, target, targetHash, operation }
  publication: null | { at, contentHash, target, previousTargetHash }
  supersededBy: null | C-0002
---
<!-- body: the exact markdown file that will be published, including any frontmatter -->
```

Binding set = `{contentHash, target, targetHash, operation}`. `contentHash` = SHA-256 of the exact body bytes the CLI stores and will write (CLI normalizes EOL to LF once at store time and records that fact). `targetHash` = SHA-256 of the raw target file bytes; the sentinel `"absent"` represents a missing target (never the hash of an empty file). Human-readable search, candidate, review, approval and publish results display one of the four category labels: Agent Note, Defensive Pattern, Postmortem, or Cookbook; structured candidate results include `kind` and `category`. For `candidate list --json`, retain the legacy `candidates: string[]` field and add `summaries` with category metadata.

Semantics:

1. `candidate new` → `draft` with `operation` derived from `target` existence (create/update). `candidate submit` → `submitted`; requires: non-empty body; body passes the full document gate for its `kind` (except that target/lifecycle legality is checked separately); target is inside the configured root for `kind` and legal for the kind (notes: lifecycle folder must match body `Status:` after publish, and class must be in the closed set).
2. `candidate revise <id> --body <file>` → new draft revision of the same candidate id: appends the old revision record to `.ake/candidates/<id>.revisions/`? **No** — v0.1 keeps history simple: it increments `revision`, resets state to `draft`, clears `reviews`/`approval` (they were bound to the old bytes) and keeps one file. If a candidate was already `published`, revising it is refused — publish a new candidate instead.
3. `review --reviewer R --verdict approve|request-changes|reject` is independent mode: requires `submitted`/`reviewed`, `R !== author`, and records `{reviewer, mode: independent, verdict, contentHash, target, targetHash, operation, at, notes}`. Explicit `review --self-review` uses the actual candidate author as reviewer and records `mode: self`; it never claims independence. Both modes require non-empty notes for approve/reject, preserve status transitions and full binding, and reject stale content. Any current `approve` → `reviewed`; latest bound `reject` → `rejected`; `request-changes` stays `submitted`. The Skill may report reviewer outcomes as `PASS`, `PASS WITH LIMITATIONS`, or `BLOCK`, but maps them to the unchanged CLI verdicts: PASS → `approve`; PASS WITH LIMITATIONS → `approve` only when core claims are supported and limitations are already explicit in the candidate, otherwise `request-changes`; BLOCK → `request-changes` for remediable issues or `reject` otherwise. For reviewer rubric only, A is strong relevant evidence such as source code/change, executed test logs, reproducible results, or before/after comparisons when relevant. B is relevant current-context evidence such as current runtime/system status, actual browser inspection, this Session Agent's direct verification, user confirmation, or readable configuration/install scripts/system state; B need not be persisted and requires no separate ID/artifact or independent locator for session observations. C means the core claim lacks basic relevant support, evidence does not support the claim, or available evidence contradicts it. A/B can support the relevant core claim; C on a core claim blocks. Missing session IDs, event numbers, standalone evidence files, or unrelated topics alone do not lower evidence level or block. If potentially reusable knowledge is identified but evidence is insufficient, report it as pending evidence with the gap and verification path, not as “no new knowledge.” A reviewer response must actually be received; dispatch/acceptance is not a review. After one `request-changes`, the Skill may perform at most one automatic revision and request one new independent review; if still unresolved, pause. These are Skill workflow rules, not new CLI behavior.
4. The CLI retains both authorization modes for interface compatibility: `approve <id> --confirm` (or `--automatic --confirm`) records local automatic authorization after a current bound approve review; `approve --by <human> --confirm` selects declared human authorization and requires an independent approve review. `--by` is a declaration, not a verified signature. Without `--confirm`, no mode writes anything. **For the AKE Skill workflow**, a reviewer pass is not publish authorization: the Skill must wait for explicit user authorization before calling `approve` or `publish`, and must use the declared human mode. This prompt-level workflow restriction does not change the CLI's accepted interface or turn it into an identity/authentication boundary.
5. `publish [--dry-run]` fail-closed requires ALL of: status `approved`; approval bound to the current binding set; >=1 current approve review compatible with authorization mode (independent records require a non-empty reviewer ≠ author; legacy records without `mode` count as independent; automatic self-review requires `mode: self` and reviewer === author); recomputed body hash equal to stored `contentHash`; target inside a configured root and legal for the kind; target hash equal to `targetHash` (missing target when `"absent"`, or existing content when a hash) — any drift refuses with `target changed since candidate creation; re-review required`; body passes full document validation; resulting document id does not collide with an existing document id; no unresolved conflict reported by `candidate check`. On success: write the body with a temp file + `rename` (atomic within the directory), re-read and verify the written hash, set `published` + `publication`, append one JSON line to `.ake/publish-log.jsonl` `{at, id, revision, target, contentHash, previousTargetHash}`. The CLI never runs `git commit`; the publisher decides.
6. Crash window: before the atomic write the CLI persists an in-flight marker (`pendingPublication: {at, contentHash, previousTargetHash}`) in the candidate record. If the target write succeeds but the state/log update then fails, the command exits 1 with `publish result unknown: target written, ledger not updated; reconcile manually` and leaves the marker in place. Never auto-replay, never overwrite the target to "retry". Any later plain `publish` refuses while the marker exists, including the case where the target bytes happen to equal the stored `targetHash` (a bytes-identical update makes drift undetectable). Recovery is explicit: `publish <id> --reconcile` completes the ledger only when the target's current bytes hash equals the candidate `contentHash`; otherwise it refuses and keeps the marker.
7. No multi-file transaction and no TOCTOU-free exclusivity is claimed: hash re-checks immediately before rename detect *observed* drift, but a writer that changes the target after the check is not prevented. A single designated publisher is a collaboration convention (§1 boundary statement).
8. `candidate check <id>` reports: body validation errors, binding drift (content/target/operation), stale vs bound reviews, id collision, and an advisory similarity report (same normalized title or >= 60% token overlap with an existing doc). Advisory only; publishing still requires the gate in (5).

## 7. `ake init` (conservative, idempotent)

Preconditions: target resolves to a valid, non-bare Git work tree (§4.8); otherwise the direct CLI exits with a clear message and **zero AKE project writes**. The CLI never runs `git init` or creates a first commit. The Skill may separately request explicit selection for a clearly non-repository target and invoke its standalone helper, using a host-native choice when available or Lead-mediated plain-text options when the host lacks native-choice capability; in a Team, only the Lead invokes the helper after the user's explicit target-specific choice, and an explicit policy/permission denial of user interaction is not a fallback trigger. Bootstrap dry-run never initializes Git. Existing parent/linked worktrees are valid, including unborn branches; a subdirectory is initialized in place and is never promoted to the repository root or given a nested `.git`. `--dir` is optional: without it the target is `process.cwd()` at invocation. The helper binds execution to an inspect-time directory identity (device/inode/birthtime), clears inherited `GIT_*`, rechecks parent/root metadata, and verifies the post-init work-tree root. Git itself may write default configuration and copy template files as well as create Git metadata; the helper does not promise a Git-init-only write set and does not add/commit/push. If execution or verification is uncertain, it stops without retry or cleanup and preserves the resulting state. A directory identity snapshot binds the path instance but is not consent or authentication. Git has no atomic create-only `init` mode: single-writer operation and checks before/after narrow but do not eliminate external TOCTOU. Host-native or Lead-mediated text selection remains a soft workflow rule, not a security boundary.

Plan first, then apply. Each item gets exactly one outcome:

- `created` — absent and safe; written.
- `identical` — exists, byte-identical; not rewritten.
- `skip` — intentionally not processed (e.g. a directory already present); reason reported.
- `conflict` — exists with different bytes, wrong type, unreadable or unsafe to write; left untouched, reported with path and source.

Exit 1 if any conflict; 0 otherwise. Mixed outcomes still create safe missing items. `--dry-run` prints the plan only. Never overwrite differing files, upgrade, delete, auto-commit, or modify `package.json`; the only merge is the specified append to an existing unmarked `AGENTS.md`. Never write outside the project root; refuse paths that resolve through symlinks escaping the root.

Item set (templates contain knowledge index pages and the `AGENTS.md` block; the config is generated from code). Skill installation is separate and uses `skills/ake/` as its source. Every init result carries a user-visible `skillNotice` that the Skill must be installed separately and is used for triggered retrieval/capture; it does not imply the Skill was installed or loaded:

- four knowledge roots with the templates' index READMEs;
- `.ake/config.json`, generated from the code's defaults (not a template copy);
- `.ake/tools/scripts/ake.mjs` + `.ake/tools/src/lib/*.mjs` (byte-identical `.mjs` copies);
- `.ake/candidates/` directory (the publish log is created on first publish, not as an empty file);
- `AGENTS.md` handling below (template file `templates/project/AGENTS.md` is the marker-wrapped block; `.ake/AGENTS-fragment.md` receives the same block for manual merging).

`AGENTS.md`:
- absent → `created` from the template, whose content is wrapped in `<!-- ake:begin -->`…`<!-- ake:end -->` so a later explicit merge is well-defined.
- present and contains exactly one complete matching marker block → `identical`.
- present without markers → append marker block by default, preserving every original byte; `.ake/AGENTS-fragment.md` is written too. Re-running is `identical`, never duplicate-append.
- present with malformed/unpaired/duplicate markers → `conflict`, unmodified.
- `--merge-agents` remains accepted for compatibility; merging is the default. Complete but differing blocks also conflict and are never overwritten.

Skill discovery statement: `<projectRoot>/.agents/skills/ake/SKILL.md` matches the DSH filesystem skill provider's project root (`<projectRoot>/.agents/skills`, direct `name/SKILL.md` bundle, frontmatter `name`/`description`). Path presence is not proof of loading: same-name shadowing or a disabled provider still prevent it (P-UNVERIFIED-2).

### 7.1 Offline initialization through the distributed Skill

The Skill distribution at `skills/ake/` includes `bootstrap.mjs`, `preflight.mjs`, the separate `init-git.mjs` helper, and `resources/ake-source/`, a minimal, self-contained source tree containing the existing `scripts/ake.mjs`, all `src/lib/*.mjs`, the project templates, and package metadata (`name`, `version`, ESM type and Node engine). The project bundle has no runtime dependencies and deliberately reuses the existing initializer; the Git-selection helper is separate and does not fork `src/lib/init.mjs` or the `ake init` contract.

`scripts/sync-skill-bundle.mjs` deterministically copies those source inputs to the Skill resource tree. `node scripts/sync-skill-bundle.mjs --check` compares expected file bytes and the complete file list, reporting missing, differing and unexpected files. `npm run check` runs this consistency check. The checked-in Skill payload is therefore the offline resource users receive, rather than a pointer to the AKE checkout.

`bootstrap.mjs` derives its resources from its own `import.meta.url`; it accepts only an absolute target path, so it does not use the invoking CWD to locate source assets or resolve the project. Its order and behavior:

1. Resolve the explicit target and verify with sanitized `GIT_*` and `git rev-parse`; a parent/linked worktree (including unborn branch) is valid, and the target is never moved to the parent root. `bootstrap --dry-run` and normal bootstrap do not run `git init`. Only bootstrap's stable `NOT_GIT_WORKTREE`, or preflight's controlled legacy/current no-Git status diagnostic **plus independent trusted Git inspection returning non-repository**, may enter the Skill's consent flow (native choice when available; otherwise Lead-mediated plain-text fallback only when native-choice capability is unavailable, never to bypass an explicit interaction policy/permission denial). Missing Git, bare repositories, permission errors, damaged `.git`, unsupported output and all unrecognized failures stop without a prompt. The standalone helper returns canonical path plus device/inode/birthtime identity; the actual helper invocation must return that exact identity as path-binding input, which is not consent. The helper and Skill require one writer, recheck identity/Git state immediately before init, and stop on changed identity or uncertain results. Git has no atomic create-only init primitive; external TOCTOU in the final check-to-spawn interval remains possible and is not claimed solved.
2. If both `.ake/config.json` and `.ake/tools/scripts/ake.mjs` are ordinary files, preserve them and do not reinitialize, copy or upgrade; bootstrap never executes that project CLI. A config/bundle version comparison cannot establish the project CLI version. If either entry is present but the other is missing, either is a symlink/non-file, a parent path is not a directory, or inspection is denied, stop with a classified error and zero project-file writes; do not treat the target as fresh. Initialize only when both entries are absent.
3. For an initialized target, the Agent runs `preflight.mjs --dir <absolute-target>` once. It fixes cwd to the target's canonical real path, invokes the project CLI only as `status --json` (plus reads the separate bundled CLI static version declaration for optional advice), and requires an absolute `project` value whose real path matches the target. Only an ordinary status exit code 1 with no spawn error or signal and the complete known legacy/current no-Git diagnostic in exactly one output channel (stderr with empty stdout, or exact plain/JSON stdout with empty stderr) triggers the separate Skill `init-git.mjs --inspect` with sanitized `GIT_*` and the exact canonical target. Permission/launch errors, signal termination, other exit codes and unknown output stop without starting another executor; arbitrary substrings/error-code tokens never qualify. Only a successful `non-repository` result combined with that controlled status signal maps to `NOT_GIT_WORKTREE`; independent `GIT_UNAVAILABLE`, `BARE_REPOSITORY`, corrupt/permission/unknown errors retain a fail-closed code, while valid worktrees plus a no-Git status message remain `STATUS_FAILED`. After authorized Git init for an existing AKE project, rerun preflight only—never bootstrap apply or overwrite the existing config/CLI. Preflight success establishes project selection only, not task-command compatibility or CLI version. The Agent then runs the actual requested operation directly in the same canonical cwd/env. Read-only operations run once and retain their complete output; no destructive write probes, silent root changes, `--project` bypasses, or auto-upgrades/overwrites.
5. When both project config and CLI are absent, verify the required offline files. If any are missing, report each absolute missing path and README recovery instructions without writing the project. Run the bundled original `ake init --dry-run --json` and display its plan. A conflict found by that preview stops before apply. `--dry-run` stops after displaying the plan; normal apply invokes the same initializer after a conflict-free preview.

Preview then apply is neither atomic nor TOCTOU-safe. A concurrent change after preview can cause the core initializer to observe different plan outcomes and make mixed writes; use a single writer. The Git-selection helper has a separate residual race: it binds the confirmed path instance by device/inode/birthtime, then rechecks identity and repository state immediately before spawning Git, but `git init` has no atomic create-only option and an external process can still establish `.git` between the final check and spawn. The helper does not claim this external race is eliminated; it refuses detected `Reinitialized` output and stops on every uncertain result without retry/cleanup/apply. This output is only a negative stop signal, never proof of safety. The zero-write conflict statement applies only when the preview itself detects the conflict, not when files race between preview and apply. The core `init` contract otherwise remains unchanged, including acceptance of target subdirectories inside an existing work tree.

The Skill asks only after an explicit `NOT_GIT_WORKTREE` result and a fresh helper inspection, showing the exact canonical path and inspection-time identity. In a Team, only the Lead asks the user: first use the host-native choice if available; only when the host lacks native-choice capability does the Lead present plain-text options tied to that path: `1` to initialize this exact target and continue, or `2` to defer initialization. An explicit policy/permission denial of user interaction is not a fallback trigger and must not be bypassed through text. Only the user's explicit reply `1` to that prompt authorizes the helper; the Lead must freshly inspect and directly invoke the helper using that identity, without transferring consent or execution to a child Agent. A child Agent neither asks the user nor invokes `init-git.mjs`. Refusal/`2` is terminal for Git initialization for the current task; empty, missing, ambiguous or other replies do not authorize initialization. Non-Git business steps may continue, while AKE/Git-dependent work is reported limited. Selecting another target requires fresh inspect and a distinct choice for the new canonical path. These are prompt-level soft rules: automated tests can check documented behavior and helper refusal/classification but cannot prove human intent or Agent compliance. Isolated integration tests copy `skills/ake/` and use temporary repositories, including the helper's linked-worktree route; they do not prove real DSH native-choice or Lead text-fallback behavior or third-party installer distribution.

### 7.2 Existing project CLI preflight through the distributed Skill

All distributed AKE CLI and Skill helper entrypoints require Node.js >=22.20.0 on the AKE host and check the version before task dispatch or child processes. In particular, `preflight.mjs` checks before invoking an existing project CLI. It does not upgrade or replace that CLI/config, and does not edit the target application's package metadata or Node requirement. `skills/ake/preflight.mjs` is an explicit helper for an already initialized project, executed once by the Agent rather than delegated to the user. It requires `.ake/config.json` and `.ake/tools/scripts/ake.mjs` as non-symlink ordinary files, canonicalizes the requested target, and invokes the project CLI only as `status --json` with cwd fixed to that target and one inherited environment snapshot; after successful identity verification it also reads the bundled user CLI's static version declaration for optional advice without executing it. The returned `project` must be absolute and resolve to the same real path; relative/missing/unresolvable/mismatching paths fail. On nonzero status it maps only stable `NOT_GIT_WORKTREE`, `GIT_UNAVAILABLE`, and `BARE_REPOSITORY` codes; everything else remains `STATUS_FAILED` and is not treated as grounds for Git initialization. `NOT_GIT_WORKTREE` leaves the existing AKE files untouched and allows the Skill's separate consent route (native choice or, only if that capability is unavailable, Lead-mediated text fallback); in a Team only the Lead executes `init-git.mjs`. After success, rerun preflight, not bootstrap. The helper neither invokes `--help` nor performs any task operation, and does not use `installation.version` as the project CLI version. Success proves project selection only.

The CLI embeds its own declared version and provides project-independent `version --json`; status adds `cliVersion`. Preflight emits `VERSION_ADVISORY` with independent Skill bundle package, bundled user CLI, project CLI self-report, and actual project config versions. Legacy or invalid declarations are unknown; config and bundle metadata must never be used to infer a project CLI version. Only stable numeric three-part versions are compared; prereleases and malformed versions yield `unknown`. A newer user CLI is a non-blocking advisory. The Skill instructs the Agent to offer to review an upgrade plan or defer, once per Session and project/version pair, and to preserve all project files until the user explicitly authorizes a concrete write plan after backup and difference review. This deduplication and consent routing are soft instructions, not host-enforced behavior; the helper does not persist a Session marker. The version command and status are self-reports, not authentication, and executing existing code cannot guarantee zero side effects.

After this one identity check, run the actual task command directly in the same cwd/env. For a read-only operation, consume its raw complete output once, including the actual invocation/options and the command's coverage information; do not repeat search or ask preflight to run it. Before an option-bearing `search`, inspect that existing CLI's `--help` in the same cwd/env and confirm that every requested option and value form is declared. If a required option is missing, help fails/is unreadable/cannot be parsed, do not run the search, silently remove flags, guess replacements, or retry; report the option as unsupported or unconfirmed. Differently worded help is acceptable when it declares all required options and value forms. For requested `--type`/`--status`, verify that returned JSON `filters` exactly match; otherwise mark filtering unverified and do not rerun. Help is a capability declaration, not proof of runtime behavior; an actual unsupported command/argument is diagnosed as such. For writes, do not make a destructive probe; make only safe evidence-based adjustments and involve the user if unresolved. Preserve cwd/env; repeat the status check when project config/CLI, cwd, environment or relevant task context changes, not before every write.

The helper uses argument-array process execution (no shell), with a 30-second timeout and 1 MiB output cap. It classifies target, project-file, status, JSON and project-identity errors. It executes existing project code, so no side-effect-free or authenticated identity guarantee is made. Host/system permission rejection is a stop condition; the docs instruct agents not to retry through wrappers/MCP/other executors, but this prompt-level rule does not prove host enforcement.

Isolated tests copy the complete `skills/ake/` payload and exercise the helper against a bootstrapped AKE CLI and controlled stubs. They verify one status call with fixed cwd/env, actual search once with filter/limit/candidate options and incomplete coverage retained from its raw JSON, acceptance of old CLIs with differently worded help, an actual unsupported-command failure, a real directory symlink, strict absolute project paths, parent/same-prefix sibling mismatches, bootstrap non-file/partial/permission path handling, stable missing-Git/unavailable-Git/bare/generic status classification, and existing AKE status recovery when `.git` metadata is removed. Git-helper tests also cover inspect/execute directory replacement, case-sensitive Windows path equality by platform simulation, exact/parent/linked worktrees, and fail-without-retry behavior. Permission tests are skipped on Windows, as root, or when the filesystem/ACL does not actually deny access. Tests do not prove third-party installer distribution or DSH host policy.

### 7.3 Installation status (`ake status`) and self-update (`ake update`)

Added by explicit user authorization (2026-11-14): installation-status reporting, a deterministic update flow, and a built-in help entry. These extend the CLI; they do not change knowledge kinds, formats, roots, candidate lifecycle or the publish gate.

`ake status` keeps every existing field and its semantics (`project`, `knowledgeDocuments`, `byTypeAndStatus`, `candidates`, `pendingCandidates`, `verified`) and adds its self-declared `cliVersion` plus an `installation` object: `os`, `loadPath`, `canonicalPath`, `scope` (`user|project|development|null`), `mode` (`canonical|symlink|copy|development|null`), `version` (the detected Skill bundle version, not the project-local CLI version), `source`, `sourceType`, `commit`, `resourcesComplete`, `agentPaths`, `remote` (fixed `unavailable`), `warnings`. The installation probe performs no Git, network or Skills-CLI call and writes nothing; project-root resolution keeps its existing behaviour (§4.8). If no host-provided load path exists, `loadPath` is a CLI-location inference and must be reported as such in `warnings`; it is never presented as host proof of loading. `resourcesComplete` requires each optional helper (`preflight.mjs`, `init-git.mjs`) only when the installed `SKILL.md` literally contains that helper's filename; this is a byte/text-presence heuristic, not semantic parsing or authentication. Legacy Skill text without a marker is not reported incomplete solely for lacking the corresponding newer file. Unprovable values are `null`/"unknown", never "latest".

`ake update [--dry-run] [--json] [--accept-customized]` updates only the loaded user-level canonical installation (`<agentsHome>/skills/ake`, real directory, plus symlinks that resolve to it), where `<agentsHome>` must resolve to `HOME/.agents`; other roots are refused rather than mapped, because the Skills CLI has only been verified to write `HOME/.agents`. Flow: identity and uniqueness → remote default branch and latest commit read from the remote itself (`git ls-remote --symref`; no hard-coded branch) with the official repository URL taken from this repository's own configuration and strictly parsed as HTTPS GitHub → up-to-date verification short circuit (no Skills CLI, npm, npm cache, temporary workspace, backup or install) → dry-run report (same no-CLI/no-npm/no-cache guarantee) → customization check against the tree of the **recorded** commit (version differences are not customizations; unknown old commit blocks unless `--accept-customized`) → acquire the fixed official `skills@1.8.1` package only for a real update in a controlled temporary workspace (explicit npmjs registry, isolated temporary HOME/cache/config, `--ignore-scripts`; validate package name/version, in-package CLI path and CLI-reported version; never inspect/use user npm caches) → verified backup under `<agentsHome>/ake/backups/<UTC-time-id>/` with a manifest and per-entry SHA-256 → install via the verified CLI as `skills add <repo>@<full-sha> --skill ake -g -y -a <existing agent set>` (add `--copy` only when the existing Skills lock records `skills.ake.installMode: "copy"`; refuse copy mode when an existing agent symlink is present because 1.8.1 `--copy` replaces it; do not change other-agent symlink layout; never use `skills update`, which does not advance a commit-pinned install; AKE never writes the lock itself) → verification of tree, lock `ref`/`skillPath`, other skill entries, resources and layout → retain live state and backup without automatic recovery on failure or uncertainty after installer start → retention cleanup only after verified success (newest 3 valid AKE backups **and** everything younger than 30 days; only complete AKE-marked backups; symlinks never followed; user copies never deleted) → report.

**Supported topology.** Canonical alone, canonical plus Claude Code, and canonical plus Claude Code and CodeBuddy symlinks are supported; CodeBuddy-only, copies, broken links and unrecognized layouts are refused. The CLI uses the existing linked agents; a single Claude link also needs the canonical codex agent to prevent copy fallback. This is not general multi-Agent support. Older installed bundles do not acquire this behavior automatically.

The current update preflight rejects any nonempty (including apparently default-equivalent) `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `VIBE_HOME`, `HERMES_HOME`, `AUTOHAND_HOME`, `GROK_HOME`, `SARVAM_HOME`, `REASONIX_HOME`, `FLATPAK_XDG_CONFIG_HOME`, or `XDG_CONFIG_HOME` in either identity or child-process environment, case-insensitively, before identity resolution or remote access. It reports variable names rather than values and leaves the paths untouched. Empty strings do not trigger refusal; whitespace-only values are nonempty and are refused. This conservative check is limited to enumerated potential overrides identified by static inspection of Skills CLI 1.8.1; it does not prove that all possible agent-specific path variables are covered. Isolated tests exercise AKE's rejection with synthetic values; the actual CLI's behavior has not been black-box verified for each variable.

**Maintenance and recovery.** The user must stop other programs from modifying AKE throughout the update. The lock is cooperative, not a defense against other writers; direct in-place replacement is not an atomic transaction. Once the installer may have started, any failure or uncertain outcome retains the live state and backup and never triggers automatic recovery or cleanup. Keep writers stopped, record the reported backup path, inspect the manifest and backup data alongside the current tree, links and lock, save a separate copy of the current state, then manually reconcile only after reviewing differences and backup integrity; do not blindly retry.

The official repository URL is resolved once from the program that starts the update and reused for the whole run; post-install verification and reporting never re-derive it from the newly installed payload, so updating to an older commit that predates `repository.url` still succeeds (with an explicit warning that the next update needs a version containing that field). Target resource verification requires each optional helper (`preflight.mjs`, `init-git.mjs`) only when the verified target `SKILL.md` literally contains its filename; this presence check is a compatibility heuristic, not semantic validation/authentication. A legitimate old commit without a marker remains verifiable; a marked target with the helper missing fails closed. Latest checks and dry-runs do not invoke a Skills CLI or npm and do not depend on any npm cache. A real update obtains only `skills@1.8.1` from `https://registry.npmjs.org` in its controlled temporary workspace, with lifecycle scripts disabled; the exact package identity/version, contained CLI entry and reported CLI version are checked before backup or installation. npm's registry transport/package-integrity checks are trusted; AKE does not pin an independent package digest or signed attestation, and package metadata/version checks alone are not cryptographic authentication. Failure to acquire/validate the CLI aborts before backup/install. No preinstalled CLI or user cache is used. npm's HOME/USERPROFILE, APPDATA/LOCALAPPDATA, XDG config/cache, user/global config, cache and logs are isolated under the temporary acquisition workspace. Before invoking Skills, AKE derives HOME only from the verified `<agentsHome>/skills/ake` installation identity, aligns HOME/USERPROFILE and Windows profile/config variables, requires a real non-symlink HOME, and checks a child Node `os.homedir()` sentinel; Windows-specific behaviour remains unverified on native Windows. `--copy` is passed only when the existing Skills lock records `skills.ake.installMode: "copy"` (filesystem directory type alone is not evidence of copy mode); a copy-mode lock combined with an existing agent symlink is refused before CLI acquisition/backup because CLI 1.8.1 `--copy` replaces that link with an independent directory. Other-agent symlink layouts are not changed by forcing copy mode. Customization for a local-source installation without a recorded commit is judged against the recorded source directory only when it is an absolute, real, Git top-level directory whose `skills/ake` is unmodified; otherwise the result is `unknown` and `--accept-customized` is required.

Exit codes: `0` success (including `--dry-run` and up-to-date), `1` refusal/failure, `2` usage error. `--json` prints exactly one object on stdout; diagnostics go to stderr. The replacement is **not atomic** — the Skills CLI rewrites in place — so backup and verification are mitigations, not a transaction; failures require manual recovery. Concurrency is coordinated only through `<agentsHome>/ake/update.lock` (`open('wx')` + random token, no automatic stale reclaim); processes that do not honour the protocol are unaffected. The first update may be started from an official source checkout (matching origin, unmodified `skills/ake`) solely to migrate a local-source installation; content still comes from the remote target commit and the lock is still written by the Skills CLI. An already installed older GitHub-pinned bundle that predates `ake update` cannot self-bootstrap this command, and the checkout exception does not authorize using a source checkout to update such a pinned installation; operators must first install a refreshed official commit through the supported Skills CLI/approved deployment path, then use `ake update` for subsequent updates. Windows path, locking and in-use behaviour is unverified.

### 7.4 AKE host runtime floor

The AKE CLI and distributed Skill entrypoints (`bootstrap.mjs`, `preflight.mjs`, and `init-git.mjs`) require Node.js >=22.20.0. Compare numeric major/minor/patch components; Node 20.x and 22.19.x fail, while 22.20.0 and later pass. Reject with a clear `NODE_VERSION` error containing the current and minimum versions before command dispatch, target-project CLI execution, Git/network subprocesses, or project writes. Keep existing CLI JSON contracts: general command failures use the normal `{ok:false,error,errors,warnings}` object; `update --json` returns its regular update-result shape with `stage: preflight` and `errorCode: NODE_VERSION`; Skill helpers keep their existing stderr code/exit behavior. ESM loads static imports before entrypoint code; all imports must still load on the previously declared Node 20 runtime so the gate can report the unsupported version. The shipped project-local CLI is an AKE executable and is guarded when newly initialized, but bootstrap/preflight preserve already existing `.ake` CLI/config and never upgrade them. This requirement applies to the Node host running AKE only: initialization does not change the target application's `package.json`, `engines`, or runtime requirement. The third-party `npx skills add` launcher is not controlled by this gate.

## 8. Verification levels (what the test report may claim)

`docs/test-report.md` must separate:
1. unit tests passing (`node:test`);
2. isolation-project integration tests passing (temporary Git repos, real `git init`, real CLI subprocesses);
3. real DSH Single-Session runs (fresh agent session, no shared history; record searches, hits, applicability judgement, application);
4. real DSH Agent Teams runs (independent reviewer, designated publisher, withheld human authorization);
5. unverified behaviours — never counted as passing.

Boundary claims to be cited with actual results, never as design assertions:

- **P-PROMPT-1** (prompt rule): Triggers are stage-specific: task-before retrieval triggers search/applicability only; task-after capture assesses value/evidence and proceeds to deduplication/candidate/review only for sufficiently evidenced, supported, reusable knowledge; explicit `/ake` follows the requested stage(s). Applicable steps continue without redundant “continue?” pauses. Automatic completion-phrase routing is a separate signal gated on substantive engineering work, loaded Skill, and explicit user completion confirmation. The workflow requires eligible independent review and its actual result, at most one automatic revision/re-review, and explicit user authorization before Skill-driven `approve`/`publish`. Soft; may be unloaded, truncated or ignored. Ordinary language cannot guarantee Skill loading or automatic routing; `/ake` is an explicit host-injection route, not evidence of general completion-phrase detection.
- **P-PROMPT-2** (prompt rule): in a shared `workspace-write` workspace, ordinary write/edit/shell can still edit formal knowledge directly; "single publisher" is a convention, not a lock; published knowledge text must not be treated as high-priority instructions.
- **P-CHECK-1** (program-checkable): for operations that go through the CLI, structure, record completeness, selected review/authorization mode, state and bound hashes are checked; declared identities are not authenticated; failures are refused per §6.
- **P-CHECK-2** (program-checkable): paths, target snapshots, observed concurrent change and init conflicts are checked; no exclusivity against writes that happen after the check, no multi-file transaction, no other write entry point.
- **P-UNVERIFIED-1** (unverified assumption): reviewer/approver declarations correspond to real, qualified, independent people. Automatic authorization is only a mode declaration; no identity or human intent is verified by the CLI.
- **P-UNVERIFIED-2** (unverified assumption): the current DSH profile enables the filesystem skill provider and the installed project skill is loaded, not shadowed.
- **P-UNVERIFIED-3** (unverified assumption): real-task retrieval recall, applicability judgement, adherence rate, redaction, cost and cross-task reuse are acceptable.
- **P-UNVERIFIED-4** (unverified assumption): target Node versions, package boundaries, platforms, Git worktrees and crash recovery behave as designed.

## 9. Acceptance criteria for v0.1

1. `npm test` green from a clean checkout; `node scripts/ake.mjs validate --project .` green on this repo.
2. Fresh temp Git project: `ake init` creates the layout and `.ake/tools`, creates `AGENTS.md` once, visibly reminds that Skill installation is separate, and a second run reports `identical`/`skip` and writes nothing.
3. `ake init` preserves existing unmarked `AGENTS.md` bytes while adding one trigger block idempotently; mismatched/malformed marked blocks conflict without overwrite; other conflicting files remain untouched and cause exit 1.
4. In an initialized project, CLI review and authorization interfaces remain `approve|request-changes|reject` and existing automatic/human modes remain technically compatible. The Skill workflow waits for an actual independent reviewer result and then explicit user authorization before publication; it permits at most one automatic revision/re-review. Tests verify the prompt contract and CLI gate separately; they do not claim completion phrases hard-trigger the Skill or that a real Team/reviewer complied unless that live behavior was actually observed. Publish refuses missing/incompatible review or approval, stale binding, target drift, id collision, illegal kind/target path and invalid document.
5. Format gate rejects each of: missing required frontmatter (dp/cookbook), note header/folder mismatch, missing mandatory section, dangling relative link, duplicate id, malformed marker block.
6. Evolution scenario: a candidate that partially supersedes an existing note reports the overlap and names the existing document as the update target instead of proposing a parallel duplicate.
7. CLI copied into the target (`.ake/tools/scripts/ake.mjs`) runs `search`/`validate` from a different CWD in that target with no AKE-repo dependency, in a target whose `package.json` is absent or CommonJS.
8. A copy of only `skills/ake/` can bootstrap a fresh Git root or project subdirectory inside an existing work tree from another CWD with the offline payload; it refuses invalid Git targets without writes, shows a preview before apply, stops on preview conflicts, preserves an existing config+CLI while reporting version comparison limits, and reports exact missing resources. Bundle generation/check is reproducible and included in `npm run check`; prompt-level user questioning and third-party installer copying/loading remain distinct, unverified behaviors unless separately observed.
9. In a parent Git repo containing multiple AKE projects, implicit CLI resolution chooses the nearest valid project marker; malformed or escaping markers fail rather than fall through. Explicit `--project` selects its exact directory, including default-config behavior when unmarked. `status`, `search` and candidate writes are tested from a different CWD; no-config Git-root compatibility remains covered.
10. The distributed Skill preflight runs once under fixed cwd/env and only verifies an absolute `project` matching the canonical target via `status --json`; it never probes task capabilities. The actual read-only task command runs directly once and its original options and coverage are retained; writes have no destructive probe, and exact help wording does not block execution. Recheck identity on cwd/env/project/task-context change, not before every write. Bootstrap refuses partial, non-file, symlink, non-directory-ancestor and permission-denied states instead of initializing. Tests cover legacy help differences, actual unsupported-command errors and search options/coverage; they do not establish third-party Skill distribution, DSH host enforcement or arbitrary CLI trust/side-effect absence.
