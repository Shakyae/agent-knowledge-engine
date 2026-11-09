# Agent Note: Preconditions for letting Agent Teams publish knowledge without a human

Status: proposed

## Problem

Every formal knowledge change in v0.1 needs a declared human authorization, even when a team independently reviewed the candidate. If project knowledge grows, that human step becomes the throughput limit, and teams will be tempted to drop it "just this once" in unsanctioned ways. The research report already lists what automatic publishing would require, and none of it exists yet.

## Proposal

Do not implement automatic publishing in v0.1. If a later version wants it, it must first satisfy all of the following, each independently verifiable:

1. A published policy fixes which low-risk categories and operations may auto-publish, and excludes high-risk, fact-conflicting, evidence-insufficient and deletion changes.
2. The candidate is immutable once submitted: the approving reviewer's record binds the hash of the exact bytes to publish (already true in v0.1).
3. Reviewer independence is established by something other than a self-declared string — a verifiable identity or a controlled context boundary — and the same party cannot both generate and approve.
4. The publish entry point re-verifies dedupe, target drift, permissions and evidence, and fails closed on any missing or unobservable input.
5. Authors and reviewers cannot bypass the publisher by editing formal knowledge directly: all write entry points (file tools, shell, Git, plugins, external editors) are inside a permission boundary.
6. Failures are recoverable: multi-file changes are idempotent, state is recoverable, and an interrupted publish reports an unknown result instead of replaying.

Until all six hold, the human authorization step stays.

## Alternatives considered

**Keep human authorization indefinitely.** A legitimate position: knowledge changes are rare in small projects, and the cost is a single approval per batch. It stays the default; this note exists only to record the preconditions if that changes.

**Let an independent agent auto-publish with a plugin-enforced gate.** Rejected for now: it requires a host plugin, trusted identities and isolation of every write entry point, which the research explicitly did not prove feasible, and the cost lands on every consuming project.

## Acceptance criteria

A future change qualifies only if it demonstrates, in a written test report: the policy and its category list; a reproducible end-to-end automatic publish of a low-risk change; at least one refused high-risk change; a failed independent-review path that blocks publish; a demonstrated bypass attempt that the boundary actually stops; and a recovery run after an interrupted publish.

## Risks

The main risk is shipping this list as if it were a plan. Identity and write-entry isolation are the expensive parts and may prove impractical, in which case the honest outcome is "stay manual", not a weaker gate presented as enforcement.
