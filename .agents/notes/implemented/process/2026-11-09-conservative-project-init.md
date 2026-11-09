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
