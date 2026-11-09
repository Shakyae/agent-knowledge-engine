---
pko:
  type: cookbook
  id: CB-knowledge-workflow
  status: active
  created: 2026-11-09
  scope: ["an agent doing a development task in a PKO-initialized project"]
  evidence: ["docs/test-report.md", "skills/knowledge-ops/SKILL.md"]
  verified: 2026-11-09
---

# Run the retrieve → capture → review → publish loop

## When to use

You are an agent starting a development task in a project that installed PKO, or you just solved a problem there and want to know whether it produced durable knowledge.

## Prerequisites

- `.pko/tools/scripts/kno.mjs` exists in the project (installed by `kno init`).
- The task is not trivial: a pure formatting change or a question with no code impact may skip the search (say so in the summary).

## Steps

1. **Frame the query.** Turn the task into terms: the modules and paths you will touch, the technology, the error symptom, and the kind of operation (migrate, deploy, review).
2. **Search all four kinds.** `node .pko/tools/scripts/kno.mjs search "<terms>" --limit 10`. Read the openings of the hits only; do not load the knowledge base into context.
3. **Judge applicability.** Open the few most relevant documents. Check the recorded `scope`, `status` and `verified` against the current code and environment; a stale or superseded document is a lead, not an instruction.
4. **Apply and say so.** Use the knowledge in the change and name it in your task summary, with the path of the document you used.
5. **Decide whether anything durable was learned.** If the experience is a lasting decision, a verified procedure, a defect class or an incident with a reusable lesson, first search for the document that already owns that fact. Update it rather than adding a parallel copy.
6. **Create the candidate.**
   `node .pko/tools/scripts/kno.mjs candidate new --kind <note|defensive-pattern|postmortem|cookbook> --title "<title>" --target <repo-relative path> --author "<you>" --body <file>`
   Include evidence (test paths, commit ids) and the applicability scope in the document itself.
7. **Submit and check it.**
   `node .pko/tools/scripts/kno.mjs candidate submit <id>` then `node .pko/tools/scripts/kno.mjs candidate check <id>`; resolve reported validation errors and read the similarity report before asking for review.
8. **Have someone else review it.** A different agent or human records the verdict:
   `node .pko/tools/scripts/kno.mjs review <id> --reviewer "<name>" --verdict approve --notes "<what was checked>"`.
   A candidate author cannot review their own candidate; the CLI refuses.
9. **Obtain explicit human authorization.**
   `node .pko/tools/scripts/kno.mjs approve <id> --by "<human>" --confirm`.
   Without authorization, leave the candidate pending — never publish on your own judgement.
10. **Let the designated publisher publish.**
    `node .pko/tools/scripts/kno.mjs publish <id>`; the CLI refuses if content, target or target bytes changed since review. Commit the result and keep the candidate record.

## Verification

- Step 2 prints `searchedRoots` and `coverage`; a `coverage: incomplete` result means "unknown", not "nothing relevant".
- Step 8 fails when the reviewer string equals the author string.
- Step 10 fails with `target changed since candidate creation` after any edit of the target; re-review is required.
- `node .pko/tools/scripts/kno.mjs validate` passes after publishing.

## Related

- [Candidate lifecycle and hash-binding](../../.agents/notes/implemented/architecture/2026-11-09-hash-bound-publish-gate.md)
- [Knowledge-Ops skill](../../skills/knowledge-ops/SKILL.md)
