# Agent Note: Adjudications after the independent design review

Status: implemented

## Problem

The frozen v0.1 contract and the independent design review disagreed in six places: whether Agent Notes carry machine frontmatter, which path tree Notes use, what a review and an approval must bind, how initialization reports outcomes, whether a truncated search may claim complete coverage, and how a publisher recovers from an unknown write result. Leaving them ambiguous would have let implementation, tests and documentation each pick a different answer.

## Decision

The Lead adjudicated and froze the contract in [architecture.md](../../../../docs/architecture.md); this note records the decisions and why.

1. **Agent Notes keep the official format and carry no frontmatter.** The first three lines are the official header, the lifecycle and class are path-encoded (`.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md`), and `## Problem` / `## Alternatives considered` / lifecycle sections are mandatory. A machine frontmatter block here would have contradicted the official header; the other three kinds carry a minimal `pko:` block because their official formats have no machine-readable status.
2. **Reviews and approvals bind the full binding set** `{contentHash, target, targetHash, operation}`, not the candidate hash alone. Approving content and then overwriting a different target is the case that costs data.
3. **Initialization has exactly four item outcomes** — `created`, `identical`, `skip`, `conflict` — and never overwrites, never silently edits `AGENTS.md`, and refuses a target that is not a valid Git work tree. The user's instruction file is not ours to rewrite.
4. **A truncated search result is incomplete coverage.** Truncation, unreadable files and read failures are always reported; an absent root is reported as "not installed (treated as confirmed empty)". A zero-hit message says "not found", never "does not exist".
5. **Observed drift is persisted.** Any check that sees a binding mismatch clears reviews/approval and records the invalidation; restoring the bytes does not revive the authorization.
6. **Unknown publish results need a marker and an explicit recovery step.** A pre-write `pendingPublication` marker blocks blind replay (including bytes-identical updates where drift is invisible). After independent review showed that crash recovery would otherwise require hand editing, the Lead decided to add the explicit `publish --reconcile` interface: it verifies the target bytes against the approved content, matches an existing ledger line by candidate id/revision/target/content-hash (backwards compatible with old lines lacking `revision`) and only repairs candidate state, or appends exactly one `reconciled: true` line when none exists; it never rewrites the target. This is recorded as contract §6.6, not as a routine publish path.

## Alternatives considered

**Follow the review verbatim, including "never create `AGENTS.md` when absent".** Rejected: a target project initialized without the retrieval entry point would lose the prompt-level half of the product, and creating a file the user asked `init` to install is not the same as overwriting one. The review's conservatism is preserved for existing files.

**Keep one uniform frontmatter schema for every kind.** Rejected in [the format note](../architecture/2026-11-09-official-formats-over-uniform-schema.md): it breaks the official note header and imports a lifecycle that cookbooks and post-mortems do not have.

**Trust live hash comparison instead of persisted invalidation.** Rejected after the acceptance test reproduced approval revival: a real restore-then-publish sequence succeeded, which is exactly the failure the binding is meant to prevent.

## Consequences

The tool needs kind-aware validation (Notes without frontmatter, the others with it) instead of one generic pass, and two extra states in the candidate record (`invalidations`, `pendingPublication`). In exchange, the publish gate's promises are checkable: each refusal has a persisted cause, and the tests can assert them from disk rather than from in-memory objects. The recovery flow adds one CLI flag and no service.
