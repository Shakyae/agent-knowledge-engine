# AKE v0.1 — Test Report

Status: v0.1 acceptance record. Every claim below carries its evidence level. Anything not executed is listed as unverified and is not counted as passing.

## Naming

v0.1 was developed under the working name `PKO` and CLI `kno`, and delivered as **AKE** (`Agent Knowledge Engine`) with CLI `ake`. The rename was mechanical (`.pko/` → `.ake/`, `pko:` → `ake:`, `kno` → `ake`) and re-verified: 59/59 tests and `validate` 0/0 after it. See `.agents/notes/implemented/process/2026-11-10-rename-working-name-to-ake.md`; reports in `docs/reviews/` were renamed with the same rules (see `docs/reviews/README.md`).

## Environment

- macOS (darwin), Node.js `v26.13.0`, npm `11.20.0`, Git `2.56.0`.
- DSH `0.2.2-rc.1` installed package; Agent Teams preset "标准研发团队-diy" (lead + advisor + executor + reviewer).
- Clean-checkout verification: a fresh `git clone` of the v0.1 commit produced **59/59 tests passing, `validate` 0 errors / 0 warnings**, and a clean working tree afterwards (`git status --short` empty).

## Evidence levels

| Level | What it proves | How it was produced |
|---|---|---|
| 1. Unit | pure parsing/search/lifecycle logic | `node --test tests/unit` |
| 2. Isolation integration | the real CLI over real Git repos | `node --test tests/integration`, subprocess CLI + real `git` in `os.tmpdir()` |
| 3. Real DSH Single Session | an independent agent session retrieves and applies knowledge | fresh sub-agent session, no shared history, isolated project |
| 4. Real DSH Agent Teams | independent review, single publisher, drift detection | three team members acting in an isolated project |
| 5. Unverified | not claimed | listed at the end |

Simulated calls are never reported as real DSH integration. The team runs below are single observations, not statistics.

## Level 1 — unit tests

`node --test tests/unit` → **38 tests, 38 pass, 0 fail**. Files: `documents.test.mjs`, `candidates.test.mjs`, `publish.test.mjs`, `frontmatter.test.mjs`, `search.test.mjs`, `init.test.mjs`, `core.test.mjs`.

Covered: four-kind format gates (positive and negative; note header/lifecycle/class, implemented notes rejecting proposal sections, post-mortem required sections and resolved-guardrail link, defensive-pattern labels, cookbook steps/verification), fenced-code pseudo headings, README index pages, link resolution, unknown metadata, search scoring/limit/type/CJK/coverage semantics (including `truncated ⇒ coverage: incomplete`), candidate binding and revision invalidation, publish refusal paths, init plan states and symlink escape.

## Level 2 — isolation-project integration tests

`node --test tests/integration` → **21 tests, 21 pass, 0 fail**. The suite runs the real CLI as a subprocess against projects under `os.tmpdir()`; all six files (cli, e2e, init, publish-gate, search, tools) initialize real Git repositories with `git init` where a repository is required, and each test removes its temporary directory via `t.after(...)` or a `finally` block.

- `init.test.mjs`: created / identical / skip / conflict plan, second run writes nothing, pre-existing `AGENTS.md` untouched, fragment file written, marker variants conflict, non-Git target refused with zero writes.
- `publish-gate.test.mjs`: full draft→submit→review→approve→publish; refusals for missing approval, self-review, stale approval, content drift, target drift, path escape, invalid document, id collision, custom roots, in-flight unknown result, and no blind replay; `--reconcile` recovery.
- `e2e.test.mjs`: init → publish a note → search from a different working directory → validate; copied `.mjs` CLI under a CommonJS/no `package.json` target.
- `cli.test.mjs`: project-root resolution (`--project`, nested directory, external CWD), exit codes, JSON shapes.
- `search.test.mjs`, `tools.test.mjs`: coverage reporting, copied tool execution from another CWD and different package boundaries.

Repository self-check: `node scripts/ake.mjs validate --project .` → `0 errors, 0 warnings`. `node scripts/ake.mjs status` → 9 knowledge documents, 0 pending candidates.

## Test A — cross-session knowledge reuse (real DSH Single Session)

Setup: isolated Git project `.ake-tmp/lead-e2e/proj` (gitignored, initialized with `ake init`). Earlier "session" published a note about bounding retries by a caller deadline (approved and published through the candidate flow). The fixture contains a genuine bug: `src/client.mjs` retried 5 times with a fixed 2-second delay and ignored the caller deadline; `node test/client.mjs` reported `failed after 5 calls in 10006 ms`.

A **fresh sub-agent session** (no shared history, cwd = that project) was given only the bug report and asked to fix it.

Observed, from the session's own report:
- It ran `node .ake/tools/scripts/ake.mjs search "deadline retry abort timeout client"`.
- It found and read `.agents/notes/proposed/architecture/2026-11-09-deadline-budget.md` and used the note's design: one deadline budget, subtract elapsed time before each retry, stop when exhausted, expose attempts/remaining budget.
- It judged the note's status (`proposed`) and treated it as guidance rather than ratified fact.
- Implementation result: `DEADLINE_MS = 3000`, no attempt starts at/after the deadline, retry sleeps capped by the remaining budget, thrown error carries `attemptsUsed`, `remainingMs`, `deadlineMs`.
- Verification: `node test/client.mjs` → `failed after 2 calls in 3001 ms: attemptsUsed=2 remainingMs=0 deadlineMs=3000` (three runs: 3001, 3002, 3000 ms).
- The `knowledge-ops` skill **was present in its session skill catalog and was loaded**, and the skill's retrieval step is what produced the CLI search.

What this demonstrates: a new session found the knowledge published by an earlier session, judged its applicability, applied it, and avoided repeating the unbounded-retry defect without being told to look. What it does not demonstrate: recall across many tasks, adherence rates, or behaviour in other DSH profiles (single observation).

## Test B — four-kind classification

All four kinds exist in this repository and are cross-linked: the architecture decisions (notes under `.agents/notes/`), the [post-mortem of the custom-roots gate gap](postmortem/0001-custom-roots-bypassed-format-gate.md), the [general defensive patterns](defensive-patterns/general.md), and the cookbook recipes (`docs/cookbook/*.md`, which link to the notes and the skill).

Classification is enforced, not remembered: each kind is identified from its configured directory and validated against that kind's rules. A cookbook index page copied into `docs/postmortem/` was rejected with `H1 must match # Post-mortem NNNN: title`, `Postmortem requires a non-empty Status line`, `## Executive summary must be non-empty`, `## Summary must be non-empty` (isolated project, real CLI). Cross-kind pollution (a note in a defensive-patterns directory) fails the same way; ids are unique across all knowledge roots.

## Test C — Single Session human approval

In the isolated project the candidate `C-0001` went `draft → submitted` and was reviewed by a second declared identity. Then:

- `publish C-0001` before approval → `candidate status must be approved`, exit 1 (target untouched, no ledger line).
- `approve C-0001 --by "…"` **without** `--confirm` → `Would authorize C-0001 by …; rerun with --confirm`, exit 0, no write.
- Only after `--confirm` did `publish` succeed, and the ledger recorded one line with `previousTargetHash: "absent"`.

The approval string is a declaration, not a verified signature (P-UNVERIFIED-1).

## Test D — real Agent Teams collaboration

Project `.ake-tmp/team-d`, initialized by `ake init`; roles: `executor-2` (author), `reviewer` (independent reviewer), Lead (designated publisher). Every step is CLI-recorded.

1. **Distributed retrieval.** The author searched all four roots (`coverage: complete`, 0 results: "not found", not "does not exist"). The reviewer independently repeated the search and reported coverage complete, 0 results.
2. **Capture in place.** The author created candidate `C-0001` (kind defensive-pattern, target `docs/defensive-patterns/retry-and-timeouts.md`). The first `submit` was **rejected** by the format gate: `docs/defensive-patterns/retry-and-timeouts.md:1 defensive-pattern H1 is required`; the author fixed the document and resubmitted.
3. **Independent review and a failed review.** The author's attempt to review its own candidate was refused: `a candidate author cannot review its own candidate`. The reviewer read the candidate directly, ran `candidate check` (`errors: []`, `bindingDrift: false`), and recorded `request-changes` with concrete defects (a zero-timeout attempt could mean "no timeout", success/failure/deadline branches were not distinguished, evidence was untraceable). `publish C-0001` at that point → `candidate status must be approved`, exit 1.
4. **Revision invalidates review.** `candidate revise` → revision 3, status `draft`, and the stored `reviews`/`approval` were **cleared** (verified by reading the candidate file). After revision the reviewer re-reviewed the changed document only and recorded `approve`.
5. **Declared authorization + single publisher.** The Lead recorded `approve C-0001 --by "test-human (declared; identity unverified)" --confirm`, then `publish C-0001` → `published …; ledger updated`, exit 0; `validate` → 0 errors; a later `search "deadline retry timeout"` finds the published rule.
6. **Publisher identity boundary.** With the same approved candidate, the **author** ran `publish C-0001 --dry-run` → `publish dry-run passed`, exit 0. The CLI checks binding facts, not who is calling; "single publisher" is a convention (P-PROMPT-2), not a permission lock.
7. **Concurrent writer conflict.** A second candidate (`C-0002`) targeting the same file was reviewed, approved, and a concurrent edit was made to the target file. `publish C-0002` → `target changed since candidate creation; re-review required`, exit 1; the concurrent edit was preserved; the candidate's reviews/approval were persisted as invalidated.

## Test E — deduplication and evolution

Two independent observations:

1. **The tool surfaces the existing owner instead of silently adding a duplicate.** In the isolated project, a candidate for an already-documented topic but a different target path was checked: `candidate check` reported `overlap: 0.75` with `.agents/notes/proposed/architecture/2026-11-09-deadline-budget.md` and the advisory "review manually and consider updating this target instead of creating a duplicate". A stronger case in the final acceptance run reported `overlap: 1.0` for a parallel candidate aimed at a near-identical note.

2. **Evolution happens in place.** In the final acceptance project, the published note `.agents/notes/proposed/architecture/2026-11-09-budget-observability.md` was changed by a new candidate with `operation: update`, `revision: 1` and `targetHash` bound to the current bytes (a partial revision: a cancellation flag was added and the success shape narrowed). A first attempt was invalidated by a concurrent edit and refused; after the concurrent edit was removed, a fresh `C-0003` was reviewed, approved and published. The directory contained exactly one document for the topic, `validate` returned 0 errors, and `search "cancellation flag budget"` found the new content. `candidate revise` on the earlier revision-2 candidate had already cleared its reviews/approval, so no stale authorization could be reused.

Similarity is advisory only; publishing still needs the full gate. The tool never auto-merges and never claims it can decide duplication.

## Test F — target-project initialization

Executed independently by the Lead in fresh real Git repositories:

- Dry run: exit 0, plan only, `ls -a` shows no new files (only `.git` and the fixture).
- Apply: 26 items `created`, `conflicts: 0`, exit 0; second run: 17 `identical` + 9 `skip`, exit 0, `git status` unchanged (idempotent).
- Pre-existing `AGENTS.md` + pre-existing `docs/cookbook/README.md`: exit 1, both files byte-identical afterwards, other missing items created, `.ake/AGENTS-fragment.md` written for manual merge.
- `--merge-agents`: appends the marked block, preserves the original bytes, second run is stable (`identical`).
- Skill install: `.agents/skills/knowledge-ops/SKILL.md` with a valid `name: knowledge-ops` frontmatter; discovery confirmed by the Test A fresh session, which listed and loaded it.
- Copied CLI: `.ake/tools/scripts/ake.mjs` (with `.mjs` modules) runs `validate`/`search` in a target whose `package.json` is absent or CommonJS, from a different CWD and from a project subdirectory.
- Non-Git target: exit 1, zero writes.

## Failures found and fixed during v0.1

Recorded because v0.1 is only worth trusting if its defects are visible.

| # | Defect | Found by | Fixed & verified |
|---|---|---|---|
| 1 | Custom knowledge roots bypassed the whole format gate (invalid document published, validate reported 0 errors) | reviewer; reproduced by Lead | yes — kind resolved from configured roots, unknown kind fails closed; see [post-mortem 0001](postmortem/0001-custom-roots-bypassed-format-gate.md) |
| 2 | Empty defensive-pattern labels could be satisfied by the next line (`\s*\S` crossed lines) | reviewer | yes — line-anchored label checks |
| 3 | `--limit` truncation still reported `coverage: complete` | reviewer | yes — truncation ⇒ incomplete + reason |
| 4 | Write succeeded but ledger update failed could be reported as an ordinary error | reviewer | yes — unknown-result branch with non-destructive refusal |
| 5 | `submit` accepted terminal/approved states, allowing state replay | reviewer | yes — only `draft → submitted`; other states exit 1 with unchanged bytes |
| 6 | `init --dir` from outside the AKE repo asked the CWD to be a AKE project | reviewer | yes — init resolves the target itself; external CWD works |
| 7 | Revision test wrote reviews/approval only to memory, so it could pass without real invalidation | reviewer | yes — assertions now read persisted candidate state |
| 8 | Observed drift invalidated approval only in memory; restoring the bytes revived it | Lead acceptance | yes — invalidation persisted (`invalidations[]`, reviews/approval cleared, status back to submitted); restore still refuses |
| 9 | The final pre-write target re-read observed drift but persisted no invalidation | reviewer | yes — all observation points now persist invalidation; restore still refuses |
| 10 | Test B initially had no post-mortem case to classify | Lead acceptance | yes — wrote the real post-mortem 0001 above |
| 11 | A bytes-identical update could be blindly replayed after an unknown write result | reviewer | yes — in-flight `pendingPublication` marker + explicit `publish --reconcile`; verified with a real ledger failure (`publish-log.jsonl` as a directory) |
| 12 | Document diagnostics reported body-relative line numbers | reviewer | yes — file line numbers, asserted at line 13 of a 9-line-frontmatter document |
| 13 | Truncated search printed the "no matching knowledge" message while matches existed | reviewer | yes — truncated-empty prints `No results displayed … matches may exist`; genuine zero-hit keeps the fixed wording |

## Boundary claims (historical v0.1 baseline; see dated amendment below for current CLI behavior)

The observations immediately below describe the earlier implementation/review scope. They do not override the 2026-11-13 amendment supplement, which updates supported review and authorization modes while keeping identity claims explicitly unverified.

- **P-PROMPT-1 — prompt-level.** `AGENTS.md`, the installed skill and `templates/project/AGENTS.md` request pre-task retrieval, in-place capture, independent review, explicit human authorization and one publisher. In the single real-session observation the agent followed them; the CLI cannot make an agent comply, and the rules can be truncated or ignored.
- **P-PROMPT-2 — prompt-level.** A direct edit of a formal knowledge file succeeds: in Test D a `printf` append to the published target succeeded outside the CLI, and the CLI later refused to publish over it but could not prevent the write. The author's `publish --dry-run` also succeeded, proving caller identity is not checked. Published knowledge text must not be treated as high-priority instructions.
- **P-CHECK-1 — program-checkable.** For CLI operations the following are checked and refused on failure: document format for the configured kind, candidate state, bound review (reviewer ≠ author), bound approval, recomputed content hash, legal target, target hash, id collision, unknown/in-flight result. See the refusal matrix in Level 1/2 and Tests C/D.
- **P-CHECK-2 — program-checkable.** Paths (`realpath` inside project root, symlink escape refused), observed target drift, and init conflicts are checked. Writes that happen after the last check, multi-file transactions, process crashes, and other write entry points are not covered.
- **P-UNVERIFIED-1.** `--reviewer`/`--by` are declarations. Test D deliberately used the string `test-human (declared; identity unverified)`; nothing verifies a real, qualified, non-generating human.
- **P-UNVERIFIED-2.** In this environment the installed skill was discoverable and loaded in one fresh DSH session. Shadowing by a same-name skill, disabled providers and other profiles are not covered.
- **P-UNVERIFIED-3.** Retrieval recall, applicability judgement quality, adherence, redaction, token/time cost and long-term reuse are not measured; the Test A run is one observation.
- **P-UNVERIFIED-4.** Only Node 26.13.0 on macOS was exercised. Windows, older Node versions, real linked-worktree instances, process-crash recovery and TOCTOU interleavings remain unverified.

## Not verified (explicitly not counted as passing)

- Windows/other platforms; Node 20 (declared minimum) was not run.
- Real linked-worktree instance: init resolves the target with `git rev-parse --is-inside-work-tree`, but no linked-worktree run is recorded, and the unit test only covers valid-work-tree detection.
- True process crash during publish; only injected failures were exercised.
- Publisher exclusivity under simultaneous real writers; only observed-drift refusal was demonstrated.
- Real human identity, real human authorization, and review independence beyond declared strings.
- Retrieval quality, cost, adherence and cross-task reuse at scale.
- Skill loading in other DSH profiles or with a shadowing skill.

## Independent review rounds

The implementation was reviewed by an independent reviewer who did not write it, in four rounds; each round kept its report and re-verified fixes by real CLI and real Git repositories, not by reading the fix claims.

| Round | Report | Outcome |
|---|---|---|
| 1 | [review-1.md](reviews/review-1.md) | not ready: 2 P0 (custom-root bypass, empty-label bypass) and 6 P1 |
| 2 | [review-2.md](reviews/review-2.md) | not ready: remaining P1 (re-authorization after observed drift, blind replay of bytes-identical updates, line numbers, message wording) |
| 3 | [review-3.md](reviews/review-3.md) | not ready: P1-D duplicate ledger line in reconcile; §9-6 evidence independently checked |
| 4 | [review-4.md](reviews/review-4.md) | **v0.1 accepted** (59/59 tests, validate 0/0); remaining items P2 wording, fixed before this commit; unverified items not counted as passing |

Lead acceptance additionally executed, independently of the reviewed test suite: a fresh-session retrieval run (Test A), a three-member team run (Test D), the initialization safety matrix (Test F), the evolution scenario (Test E), and a real ledger-failure/reconcile run by turning `.ake/publish-log.jsonl` into a directory.

## Reproduction

```bash
npm test                                   # 59 tests: 38 unit + 21 integration
node scripts/ake.mjs validate --project .  # 0 errors, 0 warnings
node scripts/ake.mjs status
```

The real-session and real-team runs used gitignored `.ake-tmp/` projects; the commands and outputs are recorded above and in [review-1.md](reviews/review-1.md) / [review-2.md](reviews/review-2.md). Temporary projects are disposable by design — recreate them with `ake init`.

## Authorized workflow amendments — 2026-11-13

The following is a new automated-test supplement; it does not change the historical real DSH observations or establish new real Team/Single-Session behavior.

- `npm run check` (Node 26.13.0, macOS) passed: 72 unit/integration tests; repository validation reported 0 errors, 0 warnings. `git diff --check` passed.
- Isolation-project CLI coverage exercises byte-preserving/idempotent merge of existing unmarked `AGENTS.md`, malformed/mismatched marker conflict, visible separate-Skill notice, and an escaping symlink during actual apply (outside target remains untouched).
- CLI coverage exercises default automatic authorization after eligible Team-style independent review, explicit author self-review, optional legacy human approval, empty/invalid reviewer rejection, legacy no-`mode` independent records, automatic self-review target-binding drift, invalid document and duplicate ID refusals, and automatic self-review `--reconcile` after a simulated ledger failure.
- Human-readable search/candidate/review/approval/publish outputs include the applicable one of four category labels. `candidate list --json` preserves its legacy `candidates: string[]` and adds categorized `summaries`. Skill tests confirm visible/coalesced retrieval and capture notices and the structured final-report template.
- CLI publication verified historical supersession updates for the conservative-init and hash-bound-publish Agent Notes through independent review and automatic approval; see candidates C-0001 and C-0002 (both published).
- These tests establish CLI behavior only. They do not establish that a Team finds a qualified independent reviewer, that a real single-session structured self-check is performed, or that the relevant Skill is loaded. Those remain unverified; self/approver/reviewer identity remains an unverified declaration.

## Authorized amendment — offline Skill bootstrap

Environment: macOS, Node `v26.13.0`, npm `11.20.0`, Git `2.56.0`.

- `npm run check` passed: **90/90 unit + integration tests**, offline bundle consistency (`16 files`), repository validation (`0 errors, 0 warnings`).
- `tests/integration/skill-bootstrap.test.mjs` copies only `skills/ake/` into a temporary installed-Skill location and starts the copied `bootstrap.mjs` from a different CWD. Eleven integration tests cover offline initialization in a real Git root with Unicode/spaces in its path, the copied project CLI running `validate`/`search` from another CWD, a project subdirectory inside a parent Git work tree, a real linked worktree, dry-run zero writes, conflict stop-before-apply, non-Git/bare/missing-Git/unexpected-rev-parse refusal, contaminated `GIT_DIR`/`GIT_WORK_TREE` refusal (also through core `ake init`), preserving existing project config+CLI bytes while reporting config/bundle version mismatch without executing the project CLI, exact missing-resource reporting, and generated-bundle consistency. The fake unexpected-`rev-parse` test uses a POSIX executable stub and is conditionally skipped on Windows; that branch is unverified there.
- `tests/integration/project-resolution.test.mjs` adds five real CLI integration tests for nested AKE subprojects: `status`/`search`/candidate writes use the nearest project from a different CWD; explicit `--project` selects the exact project and remains usable for `candidate new` → `candidate list` after the command creates an empty `.ake/`; unmarked targets retain default config behavior; partial configs merge defaults; an empty Git-root `.ake/` remains fallback-compatible through `candidate new` → `candidate list`; linked worktrees work; malformed, incomplete, and escaping inner markers plus unsafe config paths fail rather than falling through to a parent; contaminated Git-selection environment variables do not redirect selection.
- `tests/integration/config-path-safety.test.mjs` verifies both partial-config and missing-config default-root symlink escapes are rejected before `search` can read an external sentinel, including explicit `--project` fallback. The resolver validates all effective merged paths, not only fields present in JSON.
- The copied-Skill integration also bootstraps a subproject beneath a parent AKE sentinel and uses only the installed-copy CLI for `status`, `search`, and `candidate new`; assertions show the child candidate is written under the child `.ake/candidates`, not the parent.
- The existing initializer is reused from the copied payload; no AKE checkout is required at runtime, and the copied CLI validates without a target `package.json`. The target remains exactly the requested path when it is inside a parent work tree; bootstrap does not move files to the repository root or create a nested `.git` repository.
- Existing config+CLI version reporting only compares safely read config version with bundle package metadata; it never executes the project CLI. Matching metadata does not prove the installed CLI version; missing/invalid metadata is reported as unknown.
- The prompt asks the agent to ask the user when a selected target is not a Git project. Automated tests prove only script refusal and zero writes, not that a real agent asks or follows the prompt.
- Preview/apply is not atomic or TOCTOU-safe; zero writes are verified when preview detects a conflict, not when another writer races between preview and apply. Use one writer.
- Third-party Skills CLI installation was not verified in this environment. `npx --no-install skills --version` exited 1 before invocation because npm could not access the user cache (`~/.npm/_cacache`: `EPERM`, root-owned cache files). No cache ownership/configuration was changed; the fixture-copy test is not claimed as an actual installer test.

## Authorized amendment — completion routing, independent review, and user authorization

- Updated the README, Skill, project template, root instruction, cookbook, and architecture contract. Triggers are stage-specific: task-before performs retrieval/applicability only; task-after assesses value/evidence, and candidate/review actions occur only for supported reusable knowledge with sufficient relevant evidence. Explicit `/ake` follows requested stages; automatic completion-phrase routing alone is gated on substantive engineering work, loaded Skill, and explicit user completion/verification confirmation. Applicable steps continue without redundant confirmations. The workflow still requires an actually received independent review, allows at most one automatic revision/re-review, and waits for explicit user authorization before Skill-driven approval/publication. README states older AKE-managed AGENTS blocks are not auto-upgraded; conflicts require backup and manual review/merge, never silent overwrite. The cookbook clarifies that publication authorization does not itself authorize a Git commit.
- The CLI interface remains unchanged (`approve|request-changes|reject`); reviewer labels PASS / PASS WITH LIMITATIONS / BLOCK are mapped in prompt guidance, with A/B/C evidence definitions, documented limitations allowed with approval, and fixable-vs-terminal BLOCK handling. B may be a relevant, session-local checkable observation without a persistent artifact or ID; no every-candidate test execution is required. Potential reusable knowledge with insufficient evidence is reported as pending evidence rather than “no new knowledge.”
- `npm test` → **93/93 pass**. `npm run check` → **93/93 pass**, Skill bundle synchronized (**16 files**), repository validation **0 errors / 0 warnings**.
- `tests/integration/skill-install.test.mjs` contains explicitly **synthetic case files**, not observed Tampermonkey facts. Its B example assumes (but did not actually perform) current-session actual browser inspection and Session Agent verification of button text/background/border, pseudo-element layer order, computed styles and dropdown interaction, plus user confirmation; other pages/topics are limited/unverified. No source code, test log, persistent screenshot, or session/event ID is present or required for this B example. A separate C case has no core support. Assertions check the declared expected PASS WITH LIMITATIONS / BLOCK vectors and corresponding prompt text. This is a test-vector/spec consistency check only; it does not execute AKE Skill reasoning or invoke/impersonate a host, Skill loader, agent or reviewer. Real agent behavioral acceptance remains unverified; ordinary language hard-triggering/loading, an actual Agent Team reviewer response, and agent adherence were not tested. The explicit host-injection mechanism and prompt-level adherence remain separate from CLI-enforced gates.
- `tests/integration/publish-gate.test.mjs` has a temporary Git-project CLI scenario using an explicitly synthetic Tampermonkey defensive-pattern body. Its assumed B-level current-session browser/user-confirmation vector lists arrow text/icon (`::before`/`::after` content and original-site pseudo-element background/border/dimensions), button text/color override requiring the button's own background/border check (with pseudo-element stacking checked where relevant), computed styles, and dropdown interaction; other topics are unverified, and no session/event ID or separate evidence file is supplied. The CLI accepts `candidate new` → `submit` → `check` → a simulated `review --verdict approve` record. The candidate remains `reviewed` with no CLI approval record; `publish` is refused (`candidate status must be approved`), and assertions confirm the target and publish log do not exist. This proves the CLI format/state gate only, not user-authorization enforcement, evidence authenticity, real reviewer behavior, Skill triggering, or browser behavior. No publication occurs.

## Authorized amendment — built-in help, installation status and self-update

Environment: macOS (darwin, arm64), Node `v26.13.0`, npm `11.20.0`, Git `2.56.0`, Vercel Skills CLI `1.8.1` (cached copy), official GitHub remote `https://github.com/Shakyae/agent-knowledge-engine.git` (default branch `master`).

Scope: built-in Chinese help and `/ake` entry routing, additive installation status in `ake status`, `ake update`, and the `ake init` optional-`--dir` wording and semantics tests. The knowledge kinds, file formats, roots, candidate lifecycle and publish gate are unchanged.

**Pre-development findings that shaped the change.** The authoritative source has no `ake install`, `ake link`, `ake doctor` or `ake update`; skill installation was delegated to the Vercel Skills CLI in commit `0ac7319`, so the help lists the real CLI install command instead of the nonexistent commands, and no `doctor` command was added. `ake status` already existed as the knowledge-statistics command, so it was extended additively. `ake init` already defaulted to `process.cwd()`; the change fixes the documented wording and locks the behaviour with tests rather than rewriting the initializer.

**Level 1 — unit and isolation-project integration.** `npm test` → **149 tests, 148 pass, 0 fail, 1 skipped** (the skipped case is the explicitly opt-in real-network update test). `npm run check` → same counts, Skill bundle synchronized (**20 files**), repository validation **0 errors / 0 warnings**. New coverage: `tests/integration/status-installation.test.mjs` (old `status --json` fields preserved, `installation` added, three run sources, missing/malformed lock, no network/Git/write in the installation probe), `tests/integration/init-semantics.test.mjs` (eight cases: default CWD, explicit `--dir`, Git subdirectory in place, non-Git refusal with zero writes, dry-run zero writes, conflicts not overwritten, idempotent identical files, external target from an AKE checkout without touching that checkout), `tests/integration/help-content.test.mjs` (help contains only real commands, `/ake` and `/ake help` equivalence, no knowledge scan, `ake init` shown as current-directory, every documented subcommand exists in `ake --help`), plus `tests/integration/update-flow.test.mjs` and the `update`/`install-backup`/`git-remote` unit tests.

**Level 2 — simulated integration (temporary HOME, temporary bare Git repositories, `skills` CLI stubs).** These tests exercise the real orchestration with real subprocesses and real Git repositories; only the Skills CLI itself is stubbed. Covered: up-to-date short circuit (no lock, no backup, no install), update detection with the default branch resolved from the remote rather than hard-coded, untrusted/missing source refusal, backup manifest and per-entry SHA-256 verification, drift between backup and install refused, incomplete backup refused, install failure rollback, verification failure rollback, rollback failure preserving the backup and skipping cleanup, customization detection against the old commit rather than the target, clean/modified/unknown customization with `--accept-customized`, side-effect detection (other lock entries, top-level skill entries, canonical/​link identity), lock `wx` mutual exclusion, retention cleanup (newest 3 ∪ 30 days, marked backups only, symlinks never followed), local-source baseline for legacy installs, `skills` PATH resolution falling back to `npx --no-install`, and a target commit whose bundle lacks `repository.url`. Stub results are not evidence about the real Skills CLI or DSH.

**Level 3 — real macOS observation (temporary HOME, real Skills CLI 1.8.1, real GitHub, no stubs).** A temporary HOME was installed from a clean temporary local source (`skills add <local-source> --skill ake -g -y -a codex -a claude-code`), reproducing the shape of the developer machine's local-source installation, then updated through the installed bundle's own CLI. Observed: `status` reported `scope=user`, `mode=canonical`, `version=0.1.0`, `sourceType=local`, `commit=null` and the `loadPath 由 CLI 位置推断` warning; `update` reported `status:"updated"`, `customization:"clean"` with `baseline:"local-source:<path>"`, `rollback:"not_needed"`, `oldCommit:null`, `targetCommit:450d2a711a5a3ac806bff532d03b969b6c45c2fb`, created a 35-entry backup with a valid manifest, rewrote the lock to `sourceType:"github"`, `ref:450d2a711a…`, `skillPath:skills/ake/SKILL.md`, preserved the canonical directory plus the `~/.claude/skills/ake` symlink, and emitted the warning that the installed version does not declare `repository.url`. `--dry-run` performed no install, no backup and no lock acquisition. Both `skills add` and `skills update` were additionally observed directly: `skills update` does not advance a commit-pinned installation, and `skills add` overwrites a customized `SKILL.md` without creating a backup — which is why backup, verification and rollback are mandatory.

**Independent review findings that were fixed before delivery.** The independent reviewer reproduced two data-loss risks in rollback and a backup-integrity gap: rollback deleted entries that were not in the pre-install snapshot (for example a user file created while the Skills CLI was running), rollback compared only `skills.*` in the lock and then wrote back the whole file (dropping concurrent changes to `dismissed`/`lastSelectedAgents`), and backup validation checked only manifest-listed entries instead of the actual `data/` tree. It also reported that Git tree comparison dropped `encoding: 'buffer'` (binary blobs mis-compared), that `--dry-run` still wrote npm logs under `HOME` and leaked raw npm output into JSON, that the `ake status` usage line lacked `[--json]`, and that tests inherited ambient `DSH_AGENTS_HOME`/`TMPDIR`. All were fixed and covered by tests: rollback now leaves unattributed entries untouched and reports `ROLLBACK_FAILED` while retaining the backup; lock drift on any non-`skills.ake` field refuses to overwrite; backup validation requires exact bidirectional agreement with `data/`; Git comparisons use raw bytes (non-UTF-8 blob regression); npm cache/log/TMPDIR are isolated per run and raw diagnostics go only to stderr; the usage line reads `ake status [--json]`; tests sanitize inherited environment and reject a `TMPDIR` that points inside a Git work tree with an explicit error. In a direct check, a rollback with concurrent user data and lock drift kept the user file, kept the concurrent lock state, retained the backup and refused to report success.

**Checkout-bootstrap orientation (real, macOS).** With a temporary HOME containing a local-source installation, and a clean throwaway checkout whose `origin` is the official URL, `update --dry-run` reported `initiatedBy:"checkout"`, `bootstrap:true`, `scopeBefore:"development"` and the remote target commit; the real run then migrated the lock to `sourceType:"github"` with `ref:450d2a7…`, created a verified backup, left the throwaway checkout's working tree clean, and warned that the update was checkout-initiated.

**Test-environment constraint.** `npm test` uses the operating system temporary directory for fixtures, as the repository's existing tests already did. If `TMPDIR` is pointed inside a Git work tree, the suite fails immediately with `TMPDIR points inside a Git work tree; unset TMPDIR or point it outside any repository` instead of producing misleading Git results; that is a supported-environment restriction, not a product defect.

**Real user-level update on the developer machine (macOS, 2026-11-14).** After the feature commits were pushed (`734b097`, `599b736`, `e137772`), the user-level installation was updated from the local-source `0.1.0` copy to GitHub `master`. The installed tree was first confirmed byte-equal to the official `450d2a7` payload, so the detected "modified" classification was pure version drift and the update proceeded with the explicit `--accept-customized` confirmation. Result: `status:"updated"`, a 31-entry backup under `~/.agents/ake/backups/`, the installed tree byte-equal to the `e137772` `skills/ake` tree, the lock migrated to `sourceType:"github"` with `ref:"e13777241707af4d6f1b6103f156f680672eeec9"`, and the canonical directory plus `~/.claude/skills/ake` symlink preserved. `ake status` then reported `scope=user`, `mode=canonical`, `version=0.1.0`, `commit=e137772…`, `resourcesComplete=true`; a second `ake update` (dry-run and real) reported `up_to_date` and created no new backup. Two real defects were found and fixed during this first live run and are included in the pushed history: preflight could not find a usable Skills CLI on a machine without a global binary (fixed by read-only npx-cache discovery), and identity resolution treated ordinary files under `HOME` as agent roots (fixed, with regression tests).

**Unverified / limits.**
- The real user-level installation (`~/.agents/skills/ake`) was **not** modified; the user has not authorized that, so the developer machine's own migration remains unexecuted.
- The commit produced by this change is not pushed. Because `ake update` installs exactly the remote target commit, the feature is not yet deployed from `origin/master`; an older GitHub-pinned bundle that lacks `ake update` cannot self-bootstrap it. The first deployment must use an approved Skills CLI/manual deployment of a refreshed official commit; this task did not push or touch the real user-level installation. Subsequent updates can use `ake update`.
- The checkout-bootstrap path refuses while `skills/ake` is uncommitted; the simulated tests cover its trust conditions, but the real checkout run after commit was not performed.
- Windows path, symlink, file-locking and in-use behaviour was not tested.
- Real DSH reload after an update was not observed; the documented statement (each load/injection reads disk, content already injected into the running Session is not refreshed, a restart is unnecessary) comes from the DSH package documentation, not from an executed reload check.
- Rollback, concurrency and cleanup evidence comes from temporary trees and stubs; crash/kill recovery was not exercised.

## Authorized amendment — isolated Skills CLI acquisition and real update (2026-11-15)

The earlier statement that third-party Skills CLI installation was not verified is historical and is superseded by the opt-in isolated runs below. These runs used fresh temporary HOME/cache/project trees; neither `~/.agents` nor the user npm cache was read or modified.

- `AKE_RUN_REAL_SKILLS_CLI_TEST=1 node --import ./tests/helpers/test-env.mjs --test --test-name-pattern='real Skills CLI 1.8.1 copy mode' tests/integration/update-flow.test.mjs` → **1/1 pass**. The real official `skills@1.8.1` CLI installed from a temporary local Git source. Default install produced `.agents/skills/ake` as a directory and `.claude/skills/ake` as a symlink. Re-running in the same temporary HOME with `--copy` changed the Claude symlink to an independent directory and wrote `installMode:"copy"` to the lock. The current updater refused a simulated `installMode:"copy"` + existing Claude symlink layout before acquisition or backup, preserving the link and exact lock bytes. This reproduces why that mixed layout must fail closed.
- `AKE_RUN_REAL_OLD_TO_NEW_UPDATE=1 node --import ./tests/helpers/test-env.mjs --test --test-name-pattern='real official old SHA updates' tests/integration/update-flow.test.mjs` → **1/1 pass**. The real Skills CLI installed official commit `450d2a711a5a3ac806bff532d03b969b6c45c2fb` in copy mode; the current source updater then invoked the real CLI and updated it to official `master` HEAD `e6a90216d5c2f6b406fde9597e77eea5d1d7e326` (old SHA ≠ new SHA). The updated lock retained `installMode:"copy"`, the verified backup existed under the isolated HOME, and a non-AKE skill directory plus its lock record were unchanged. Only Codex was selected, so no other-agent symlink was in scope.
- `AKE_RUN_REAL_SKILLS_UPDATE=1 node --import ./tests/helpers/test-env.mjs --test --test-name-pattern='real isolated update runs' tests/integration/update-flow.test.mjs` → **1/1 pass**. A separate isolated real update from a local-source install to official HEAD succeeded with a canonical directory plus Claude symlink; repeating in the same HOME returned `up_to_date` without CLI acquisition or backup, and a recursive snapshot (paths, types, modes, file hashes and symlink targets) was identical before and after.
- The final `npm run check` passed: **166 tests, 163 pass / 0 fail / 3 opt-in network tests skipped by the default suite**, then bundle synchronization verified all **20 files** and `ake validate --project .` reported **0 errors / 0 warnings**. The three opt-in real cases were run separately as described above, not counted as passed by the skips.
- Windows profile environment mapping has unit coverage (HOME/USERPROFILE/HOMEDRIVE/HOMEPATH/APPDATA/LOCALAPPDATA/XDG/npm config/cache isolation) and HOME sentinel checks, but native Windows execution remains unverified. npm's HTTPS registry metadata and integrity checks are trusted; AKE does not pin an independent Skills package digest/signature. No real rollback-after-CLI-failure, crash recovery or native Windows run was performed.
