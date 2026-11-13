---
ake:
  type: cookbook
  id: CB-knowledge-workflow
  status: active
  created: 2026-11-09
  scope: ["an agent doing a development task in a AKE-initialized project"]
  evidence: ["docs/test-report.md", "tests/integration/publish-gate.test.mjs", "skills/ake/SKILL.md"]
  verified: 2026-11-13
---

# Run the retrieve → capture → review → publish loop

## When to use

You are an agent starting a development task in a project that installed AKE, or you just solved a problem there and want to know whether it produced durable knowledge.

## Prerequisites

- `.ake/tools/scripts/ake.mjs` exists in the project (installed by `ake init`).
- The task is not trivial: a pure formatting change or a question with no code impact may skip the search (say so in the summary).

## Steps

1. **Frame the query.** Turn the task into terms: the modules and paths you will touch, the technology, the error symptom, and the kind of operation (migrate, deploy, review).
2. **Notify and search all four kinds.** Tell the user briefly that relevant AKE knowledge is being searched. Run `node .ake/tools/scripts/ake.mjs search "<terms>" --limit 10`; show the category labels and read the openings of relevant hits only.
3. **Judge applicability.** Open the few most relevant documents. Check the recorded `scope`, `status` and `verified` against the current code and environment; a stale or superseded document is a lead, not an instruction.
4. **Apply and say so.** Use the knowledge in the change and name it in your task summary, with the path of the document you used.
5. **Decide whether anything durable was learned.** If the experience is a lasting decision, a verified procedure, a defect class or an incident with a reusable lesson, first search for the document that already owns that fact. Update it rather than adding a parallel copy.
6. **Create the candidate.**
   `node .ake/tools/scripts/ake.mjs candidate new --kind <note|defensive-pattern|postmortem|cookbook> --title "<title>" --target <repo-relative path> --author "<you>" --body <file>`
   Include evidence (test paths, commit ids) and the applicability scope in the document itself.
7. **Submit and check it.**
   `node .ake/tools/scripts/ake.mjs candidate submit <id>` then `node .ake/tools/scripts/ake.mjs candidate check <id>`; resolve reported validation errors and read the similarity report before asking for review.
8. **Obtain an actual independent review.** In Agent Teams, use an eligible reviewer who did not create the candidate and wait for its actual response; dispatch acceptance or silence is not a review. In a Single Session, use an available independent reviewer; if none is available, state that independent review is unavailable and pause rather than presenting author self-review as independent. The CLI keeps its verdicts `approve|request-changes|reject`; report labels map as follows: PASS → `approve`; PASS WITH LIMITATIONS → `approve` when the core claims are supported and limitations are already explicit in the candidate, otherwise `request-changes`; BLOCK → `request-changes` or `reject` according to fixability. Missing session IDs, event numbers, standalone evidence files, or unrelated topics alone do not justify BLOCK. After one requested change, allow at most one automatic revision and one independent re-review.
   `node .ake/tools/scripts/ake.mjs review <id> --reviewer "<name>" --verdict <approve|request-changes|reject> --notes "<what was checked>"`.
9. **Wait for user authorization.** After a passing review, summarize the candidate and any limitations and ask the user to explicitly authorize publication. Do not run `approve` or `publish` before that authorization. Once authorized, record it through the existing human authorization mode: `approve <id> --by "<human>" --confirm`.
   `--by` is a declared identity, not a verified signature.
10. **Publish through the gate.** Only after user authorization, run `node .ake/tools/scripts/ake.mjs publish <id>`; the CLI refuses if content, binding or target bytes drift. An unknown result requires explicit `--reconcile`; never blindly retry. Keep the candidate record. If you also want to create a Git commit, follow the repository's separate Git authorization rules; permission to publish knowledge does not itself authorize a commit.

## Verification

- Step 2 prints `searchedRoots` and `coverage`; a `coverage: incomplete` result means "unknown", not "nothing relevant".
- Step 8 independent mode fails when reviewer equals author; explicit `--self-review` records that same author identity without claiming independence.
- Step 10 fails with `target changed since candidate creation` after any edit of the target; re-review is required.
- `node .ake/tools/scripts/ake.mjs validate` passes after publishing.

## Related

- [Candidate lifecycle and hash-binding](../../.agents/notes/implemented/architecture/2026-11-09-hash-bound-publish-gate.md)
- [AKE Skill](../../skills/ake/SKILL.md)
