---
akeCandidate:
  id: "C-0001"
  revision: 1
  kind: "note"
  title: "Clarify superseded init contract history"
  author: "executor"
  created: "2026-11-13"
  status: "published"
  target: ".agents/notes/implemented/process/2026-11-09-conservative-project-init.md"
  operation: "update"
  targetHash: "f75ea75dcab50fadbee4b5cff8399fab5b094d1594e638abfaed3af5ed4da192"
  contentHash: "dc2753690d89b2dd44ee3d49d1360bdfa04a802d8c5348f6e18caad50e2af299"
  scope: "unknown"
  evidence: "unknown"
  reviews: [{"reviewer":"reviewer","mode":"independent","verdict":"approve","contentHash":"dc2753690d89b2dd44ee3d49d1360bdfa04a802d8c5348f6e18caad50e2af299","target":".agents/notes/implemented/process/2026-11-09-conservative-project-init.md","targetHash":"f75ea75dcab50fadbee4b5cff8399fab5b094d1594e638abfaed3af5ed4da192","operation":"update","at":"2026-11-13T07:26:08.747Z","notes":"Independent review: target update preserves historical design, explicitly identifies default-append supersession, matches init code, architecture section 7 and isolated init tests; candidate check clean and no similarity reported."}]
  approval: {"by":"automatic-local-workflow","mode":"automatic","at":"2026-11-13T07:26:28.770Z","contentHash":"dc2753690d89b2dd44ee3d49d1360bdfa04a802d8c5348f6e18caad50e2af299","target":".agents/notes/implemented/process/2026-11-09-conservative-project-init.md","targetHash":"f75ea75dcab50fadbee4b5cff8399fab5b094d1594e638abfaed3af5ed4da192","operation":"update"}
  publication: {"at":"2026-11-13T07:26:28.844Z","contentHash":"dc2753690d89b2dd44ee3d49d1360bdfa04a802d8c5348f6e18caad50e2af299","target":".agents/notes/implemented/process/2026-11-09-conservative-project-init.md","previousTargetHash":"f75ea75dcab50fadbee4b5cff8399fab5b094d1594e638abfaed3af5ed4da192"}
  supersededBy: null
---
<!-- body -->
# Agent Note: Initialization plans before it writes and refuses to overwrite anything

Status: implemented

## Problem

A project initializer is the one AKE component that runs against someone else's repository. The failure modes are asymmetric: a missing directory is easy to add later, but an overwritten `AGENTS.md` — often the most carefully tuned file in a repository — destroys standing instructions that no test recovers. Re-running the initializer after an upgrade must also not turn a partially customized layout into silent churn.

## Decision

`ake init` computes a plan first and gives every item exactly one outcome: `created` (absent and safe), `identical` (byte-identical, not rewritten), `skip` (intentionally untouched, e.g. an existing `AGENTS.md` without an explicit merge flag), `conflict` (different bytes, wrong type, unreadable or unsafe). Conflicts are reported with path and source, and the command exits 1 while still creating the safe missing items.

`AGENTS.md` is the strictest case: created only when absent (wrapped in `<!-- ake:begin -->` / `<!-- ake:end -->` markers), never modified when present without an explicit `--merge-agents` flag, and the merge only appends the marker block while preserving every original byte. Malformed, duplicated or unpaired markers are a conflict, not a repair opportunity. The target must first be confirmed as a valid Git work tree; a bare or fake repository is refused with zero writes, and no `git init` is performed. Paths that resolve outside the project root through symlinks are refused.

## Alternatives considered

**Overwrite with a backup file.** Rejected: it still mutates a user's file, creates a second authority for the same content, and makes later diffs unreadable.

**Interactive merge / three-way merge.** Rejected for v0.1: it needs conflict UI or a merge engine, and a marker-append plus a printed fragment solves the same problem with near-zero risk.

**Auto-create `AGENTS.md` and silently edit existing ones "because the rules are good".** Rejected: the user's instruction file is not AKE's to rewrite.

## Consequences

Targets that already have `AGENTS.md` must merge manually once (copy `.ake/AGENTS-fragment.md`). Init is not a migration or upgrade mechanism: after a tool upgrade, differing `.ake/tools` files are reported as conflicts instead of being replaced, so the user decides. There is no `--force`: destructive intent must be carried out by the user, not by a flag we make easy to type.

## Supersession history (2026-11-13)

The preceding statements describe the prior v0.1 initialization contract and are retained as historical design rationale. An explicitly authorized amendment now makes the marker append the default for an existing unmarked `AGENTS.md`; the initializer preserves all original bytes and remains idempotent. `--merge-agents` remains accepted for compatibility. Existing malformed or differing marker blocks still conflict and are never overwritten. See the current contract in `docs/architecture.md` §7 and automated evidence in `docs/test-report.md`.
