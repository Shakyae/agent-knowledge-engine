---
akeCandidate:
  id: "C-0002"
  revision: 1
  kind: "note"
  title: "Clarify superseded publish authorization history"
  author: "executor"
  created: "2026-11-13"
  status: "published"
  target: ".agents/notes/implemented/architecture/2026-11-09-hash-bound-publish-gate.md"
  operation: "update"
  targetHash: "728ef515a2a72d05d8e74df1e974d28a60e31b554652771de7c08db5cc513339"
  contentHash: "a529f2d218d154beeb66d144301923f45acdfa0e099cdf5077c95a50cd896eea"
  scope: "unknown"
  evidence: "unknown"
  reviews: [{"reviewer":"reviewer","mode":"independent","verdict":"approve","contentHash":"a529f2d218d154beeb66d144301923f45acdfa0e099cdf5077c95a50cd896eea","target":".agents/notes/implemented/architecture/2026-11-09-hash-bound-publish-gate.md","targetHash":"728ef515a2a72d05d8e74df1e974d28a60e31b554652771de7c08db5cc513339","operation":"update","at":"2026-11-13T07:26:08.818Z","notes":"Independent review: historical human-only restriction explicitly superseded by mode-labelled automatic authorization with bound independent or self review; checked publish and reconcile implementation, architecture section 6 and isolated gate tests; candidate check clean and no similarity reported."}]
  approval: {"by":"automatic-local-workflow","mode":"automatic","at":"2026-11-13T07:26:28.914Z","contentHash":"a529f2d218d154beeb66d144301923f45acdfa0e099cdf5077c95a50cd896eea","target":".agents/notes/implemented/architecture/2026-11-09-hash-bound-publish-gate.md","targetHash":"728ef515a2a72d05d8e74df1e974d28a60e31b554652771de7c08db5cc513339","operation":"update"}
  publication: {"at":"2026-11-13T07:26:28.987Z","contentHash":"a529f2d218d154beeb66d144301923f45acdfa0e099cdf5077c95a50cd896eea","target":".agents/notes/implemented/architecture/2026-11-09-hash-bound-publish-gate.md","previousTargetHash":"728ef515a2a72d05d8e74df1e974d28a60e31b554652771de7c08db5cc513339"}
  supersededBy: null
---
<!-- body -->
# Agent Note: Bind candidates and publish to content, target and operation hashes

Status: implemented

## Problem

Knowledge candidates are produced by one agent and approved by another, sometimes in a different session days later, while the code and the target documents keep moving. A prompt-only "review then publish" flow silently reuses an approval after the candidate body, the target path or the target file changed; the most dangerous case is approving document A and then overwriting the user's edited version of the target because only the candidate's own hash was checked.

## Decision

A candidate record in `.ake/candidates/` fixes a **binding set**: `{contentHash, target, targetHash, operation}`. `contentHash` is the SHA-256 of the exact body bytes that will be written (LF-normalized once at store time); `targetHash` is the SHA-256 of the raw target bytes, with the sentinel `"absent"` for a target that must not exist yet; `operation` is `create` or `update`.

Every review and the human approval record the full binding set. Any change to content, target path, operation or target bytes invalidates all prior reviews and approvals — staleness is reported, never silently dropped. `candidate revise` increments the revision, returns the record to `draft` and clears reviews/approval; a published candidate cannot be revised (publish a new candidate and supersede the old one).

`ake publish` is fail-closed: approved status, bound approval, bound approval-review from a different declared author, recomputed content hash, legal target path for the kind, unchanged target hash, valid resulting document, no id collision. Every point that observes drift persists the invalidation (clearing reviews/approval and returning the candidate to `submitted`), so restoring the old bytes cannot revive an authorization the tool has already seen broken.

Before the atomic write the CLI persists an in-flight marker (`pendingPublication`). The target is written via a temp file and `rename`, then re-read to verify the hash, then the candidate state and the append-only ledger are updated. If the target write succeeded but the state or ledger update failed, the command reports `publish result unknown` and leaves the marker; any ordinary publish then refuses, including the bytes-identical case where drift is undetectable. Recovery is explicit and idempotent: `publish --reconcile` matches an existing ledger line for the same candidate id, revision, target and content hash (or, only if none exists and the target already equals the approved content, appends one `reconciled: true` line); it repairs the candidate state without rewriting the target.

## Alternatives considered

**Git-branch or pull-request approval as the gate.** Rejected for v0.1: it couples the gate to a host and requires platform permissions; the CLI must work in a bare project with no forge.

**Prompt-only approval with no hash binding.** Rejected: it cannot even detect the reuse-after-edit case, which is the case that costs data.

**Automatic publishing after an independent agent review.** Rejected for v0.1: review independence and identity are declarations the tool cannot verify; publishing stays a declared human authorization.

## Consequences

Candidates are slightly more verbose and an edited target forces a re-review by design. The gate closes the observed-drift hole but is not a security boundary: ordinary file tools can still edit formal knowledge directly, and `--by` / `--reviewer` strings are declarations, not verified identities (P-UNVERIFIED-1). There is no multi-file transaction and no TOCTOU-free exclusivity after the final hash check, and real process-crash recovery is covered only by injected failures.

## Supersession history (2026-11-13)

The hash-binding, observed-drift invalidation, validation, atomic write, ledger and explicit reconciliation decisions above remain current. The claim that publishing requires a declared human authorization records the prior v0.1 contract and is superseded: default local publishing now records `mode: automatic` after a current bound review (independent Team review, or explicitly identified author self-review when no suitable reviewer is available). Human approval remains available only as a backward-compatible explicitly selected mode. Reviewer identities and automatic authorization remain declarations, not verified facts. See current `docs/architecture.md` §6 and the test supplement in `docs/test-report.md`.
