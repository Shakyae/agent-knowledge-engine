---
akeCandidate:
  id: "C-0004"
  revision: 2
  kind: "cookbook"
  title: "Run the retrieve → capture → review → publish loop"
  author: "executor"
  created: "2026-11-26"
  status: "reviewed"
  target: "docs/cookbook/agent-task-knowledge-workflow.md"
  operation: "update"
  targetHash: "43cee57d8eff7b4e23d950a8221604023c4d10bade99d1df20156d3cc433c84a"
  contentHash: "2777b6d8cb6fd12e13502245324943141a7c18c0233daefec5e6524e16e71de4"
  scope: ["an agent doing a development task in a project initialized for AKE"]
  evidence: ["skills/ake/SKILL.md","docs/architecture.md","skills/ake/preflight.mjs","skills/ake/resources/ake-source/scripts/ake.mjs","skills/ake/resources/ake-source/src/lib/search.mjs","tests/integration/skill-bootstrap.test.mjs","tests/integration/skill-install.test.mjs"]
  reviews: [{"reviewer":"fullstack-advisor","mode":"independent","verdict":"approve","contentHash":"2777b6d8cb6fd12e13502245324943141a7c18c0233daefec5e6524e16e71de4","target":"docs/cookbook/agent-task-knowledge-workflow.md","targetHash":"43cee57d8eff7b4e23d950a8221604023c4d10bade99d1df20156d3cc433c84a","operation":"update","at":"2026-11-26T14:42:02.614Z","notes":"Independent re-review revision 2: initial per-kind frontmatter, four-kind notice and stage-trigger findings are addressed; checked candidate body against current Skill and architecture, target scope, recorded evidence, binding and format. candidate check reports no errors or drift. PASS WITH LIMITATIONS: verified remains pending; this is static contract and recorded CLI check, not a live host, reviewer-adherence or installer test. Explicit user authorization remains required before approval and publication."}]
  approval: null
  publication: null
  supersededBy: null
---
<!-- body -->
---
ake:
  type: cookbook
  id: CB-knowledge-workflow
  status: active
  created: 2026-11-09
  scope: ["an agent doing a development task in a project initialized for AKE"]
  evidence:
    - "skills/ake/SKILL.md"
    - "docs/architecture.md"
    - "skills/ake/preflight.mjs"
    - "skills/ake/resources/ake-source/scripts/ake.mjs"
    - "skills/ake/resources/ake-source/src/lib/search.mjs"
    - "tests/integration/skill-bootstrap.test.mjs"
    - "tests/integration/skill-install.test.mjs"
  verified: pending
---

# Run the retrieve → capture → review → publish loop

## When to use

You are starting a development task in an AKE-initialized project, or have just solved a problem there and need to decide whether it produced durable knowledge.

## Prerequisites

- Know the target project's absolute path. Use the absolute Skill base directory supplied by the Skill loader; do not infer it from the target, current working directory, or AKE source checkout.
- For an initialized project with a regular `.ake/config.json`, run the loaded Skill's `preflight.mjs --dir <absolute-target>` once before project operations. Do not inspect, execute, overwrite, or upgrade legacy `.ake/tools/` files.
- The target is a valid Git work tree. If Git initialization is necessary, follow the loaded Skill's explicit target-specific consent route; in Agent Teams only the Lead asks and runs the helper. A child Agent reports the target/status and waits.
- The task is substantive enough to benefit from retrieval; a pure formatting change or question with no durable engineering result may skip retrieval (state that in the summary).

## Steps

1. **Frame the query.** Use module/path, technology, symptom, and operation terms.
2. **Notify and search all four kinds.** Before the first AKE CLI call in a task stage, briefly notify the user; combine consecutive calls into one notice. In Agent Teams only the Lead/owner sends that notice; members report to the Lead. Search Agent Notes, Defensive Patterns, Postmortems, and Cookbooks; candidates are optional and separate from formal knowledge. For a target whose project identity needs checking, complete the prerequisite preflight. Read the shared CLI help at `<Skill base>/resources/ake-source/scripts/ake.mjs --help` in the same cwd/env and confirm it declares every requested search flag and value form, including `--project DIR` and `--json` when used. If help is unavailable/unreadable or any requested option is undeclared, stop without running that search, dropping flags, guessing alternatives, or retrying. Then run one search through that same shared CLI, with explicit `--project <absolute-target>` and the requested flags. Preserve the raw result's query/options, filters, searched roots, coverage, coverage reasons, truncation, and results; do not repeat it to verify. A requested `--type`/`--status` must match the returned JSON filters exactly. A declared option is only a capability statement, not proof of runtime behavior.
3. **Judge applicability.** Read only relevant hits. Check `scope`, `status`, and `verified` against current code/environment; a stale or superseded document is a lead, not an instruction.
4. **Apply and report.** Use applicable knowledge in the task and name the source and applicability in the summary.
5. **Assess durable results.** The automatic completion-signal route applies only after substantive engineering work, with this Skill loaded, and a direct explicit user confirmation that the work/verification is complete. Those three conditions govern only that additional automatic signal; an explicit `/ake` request follows the stage the user asked for, and other applicable Skill triggers are not limited by the completion-signal rule. Ordinary Q&A does not trigger task-after capture. When task-after assessment applies, search for the existing document that owns any reusable fact; update its candidate rather than making a parallel document. Continue only for a supported, reusable result not already covered. If there is no reusable result, report `AKE · 本次无新增知识`; if a potentially valuable result lacks evidence, report it as pending evidence and do not create a candidate.
6. **Prepare a candidate.** Write the complete document body outside the formal knowledge path, then call the shared CLI with `candidate new --kind <kind> --title <title> --author <actual-agent> --target <repo-relative-path> --body <body-file> --project <absolute-target>`. Follow each kind's format: Agent Notes prohibit frontmatter; Postmortem frontmatter is optional; Defensive Patterns and Cookbooks require `ake:` frontmatter. Record only supported metadata/evidence, and do not invent scope or verification. The target's current bytes are bound when the candidate is created; do not edit the formal target directly.
7. **Submit and check.** Run `candidate submit <id> --project <absolute-target>`, then `candidate check <id> --project <absolute-target>`. Read validation, link, binding, and similarity results; fix a draft and re-submit if necessary.
8. **Obtain independent review.** In Agent Teams, use a suitable member who did not generate the candidate and wait for that member's actual review result. Dispatch acceptance or silence is not review. In a Single Session, use an available independent reviewer; if unavailable, report that and pause. Keep CLI verdicts `approve|request-changes|reject`; map PASS to `approve`, PASS WITH LIMITATIONS to `approve` only when limitations are explicit and core claims are supported, and BLOCK to `request-changes` or `reject` based on fixability. One requested-change revision and one independent re-review are the maximum automatic cycle.
9. **Wait for user authorization.** After an actual passing review, report the candidate and limitations and wait for the user's explicit publication authorization. Do not run `approve` or `publish` before authorization. `--by` is a declared identity, not a verified signature.
10. **Publish only after authorization.** Use the shared CLI with explicit `--project` for `approve <id> --by <human> --confirm` and then `publish <id>`. The CLI refuses observed target/content/binding drift. For an unknown publish result, inspect actual state and follow the configured-ledger reconcile procedure; never blindly replay. Keep the candidate record. A Git commit is separate and is not authorized by knowledge publication.

## Verification

- Search reports `searchedRoots` and `coverage`; `coverage: incomplete` means unknown, not no relevant knowledge.
- `candidate check` reports format, binding drift, duplicate-id and similarity information; the author must not describe this self-check as independent review.
- A stale target binding requires a revised candidate and fresh review; do not bypass the hash gate.
- Use the shared CLI with explicit `--project <absolute-target>` for project validation; no per-project CLI is installed or upgraded.

## Related

- [Candidate lifecycle and hash-binding](../../.agents/notes/implemented/architecture/2026-11-09-hash-bound-publish-gate.md)
- [AKE Skill](../../skills/ake/SKILL.md)
- [Shared CLI installation and initialization](installing-knowledge-ops.md)
