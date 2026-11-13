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
8. **Review honestly.** In Agent Teams, use an eligible reviewer who did not create the candidate. In Single Session or without a suitable reviewer, perform a structured check and explicitly record author self-review; never call it independent.
   `node .ake/tools/scripts/ake.mjs review <id> --reviewer "<name>" --verdict approve --notes "<what was checked>"`.
   For self-review use `review <id> --self-review ...`; the CLI records the author as reviewer with `mode: self`, not as independent.
9. **Use the default local automatic authorization.** After a current bound review, run `approve <id> --confirm`; this records automatic, not human, authorization. Use human authorization only when explicitly requested.
   Default: `approve <id> --confirm`; explicit human authorization if required: `approve <id> --by "<human>" --confirm`.
   `--confirm` is the CLI write confirmation; it is not an extra user authorization decision.
10. **Publish through the gate.**
    `node .ake/tools/scripts/ake.mjs publish <id>`; the CLI refuses if content, binding or target bytes drift. An unknown result requires explicit `--reconcile`; never blindly retry. Commit the result and keep the candidate record.

## Verification

- Step 2 prints `searchedRoots` and `coverage`; a `coverage: incomplete` result means "unknown", not "nothing relevant".
- Step 8 independent mode fails when reviewer equals author; explicit `--self-review` records that same author identity without claiming independence.
- Step 10 fails with `target changed since candidate creation` after any edit of the target; re-review is required.
- `node .ake/tools/scripts/ake.mjs validate` passes after publishing.

## Related

- [Candidate lifecycle and hash-binding](../../.agents/notes/implemented/architecture/2026-11-09-hash-bound-publish-gate.md)
- [AKE Skill](../../skills/ake/SKILL.md)
