---
akeCandidate:
  id: "C-0005"
  revision: 2
  kind: "cookbook"
  title: "Install and use shared AKE knowledge operations in a project"
  author: "executor"
  created: "2026-11-26"
  status: "submitted"
  target: "docs/cookbook/installing-knowledge-ops.md"
  operation: "update"
  targetHash: "dcfce2c7e35076f98134c8e32d5e7d35129c6b3722e2a33ebfcc6f0b91362b1a"
  contentHash: "ebd5bb196327b2af010d128930844fe1cfa03081eca614faf0bc212a5b93206c"
  scope: ["a target Git project that will use the AKE Skill and shared CLI"]
  evidence: ["README.md","skills/ake/SKILL.md","skills/ake/bootstrap.mjs","skills/ake/preflight.mjs","skills/ake/resources/ake-source/scripts/ake.mjs","tests/integration/skill-bootstrap.test.mjs","tests/integration/skill-git-init.test.mjs","tests/integration/update-flow.test.mjs"]
  reviews: [{"reviewer":"fullstack-advisor","mode":"independent","verdict":"request-changes","contentHash":"ebd5bb196327b2af010d128930844fe1cfa03081eca614faf0bc212a5b93206c","target":"docs/cookbook/installing-knowledge-ops.md","targetHash":"dcfce2c7e35076f98134c8e32d5e7d35129c6b3722e2a33ebfcc6f0b91362b1a","operation":"update","at":"2026-11-26T14:42:11.903Z","notes":"Independent re-review revision 2: candidate check shows no errors or binding drift and most initial findings are addressed, but step 3 instructs the Lead to inspect again AFTER authorization and invoke using that fresh identity. SKILL.md requires Lead to inspect before presenting the exact-target choice and bind execution to the same pre-consent identity; if identity changed, stop, never silently bind consent to a replacement directory. Change ordering to Lead fresh inspect before prompt, show exact canonical path, then pass that same inspection identity after explicit user selection; helper independently rechecks and rejects change. Static review; no live consent/init tested. This is the second review: pause rather than another automatic revision."}]
  approval: null
  publication: null
  supersededBy: null
---
<!-- body -->
---
ake:
  type: cookbook
  id: CB-installing-knowledge-ops
  status: active
  created: 2026-11-09
  scope: ["a target Git project that will use the AKE Skill and shared CLI"]
  evidence:
    - "README.md"
    - "skills/ake/SKILL.md"
    - "skills/ake/bootstrap.mjs"
    - "skills/ake/preflight.mjs"
    - "skills/ake/resources/ake-source/scripts/ake.mjs"
    - "tests/integration/skill-bootstrap.test.mjs"
    - "tests/integration/skill-git-init.test.mjs"
    - "tests/integration/update-flow.test.mjs"
  verified: pending
---

# Install and use shared AKE knowledge operations in a project

## When to use

You want a Git project to use AKE's knowledge layout and agent Skill, without copying a CLI into the project or overwriting existing project data.

## Prerequisites

- Node.js >= 22.20.0 and Git are available to the AKE host. This does not change the target application's own Node declaration or package metadata.
- The target is a Git work tree; a project subdirectory, linked work tree, and unborn branch are valid. Do not create a nested `.git`.
- Install the AKE Skill separately from the official repository at a reviewed full commit SHA, for example `npx skills add Shakyae/agent-knowledge-engine@<full-commit-sha> --skill ake -g`. Review and back up existing Skills/customizations first. Skill installation and project initialization are separate operations.
- Obtain the absolute Skill base directory from the Skill loader. Do not derive the Skill path from project/CWD or use a project-local `.ake/tools` copy.

## Steps

1. **Resolve the project state.** Canonicalize the target directory. If it has a regular `.ake/config.json`, it is already initialized: preserve the config and run `node <Skill base>/preflight.mjs --dir <absolute-target>` once. Preflight runs the Skill-bundled shared CLI's `status --json` and checks the reported absolute project realpath; success proves project selection only, not task-command compatibility. Do not run bootstrap apply over an existing config.
2. **Initialize only when config is absent.** Run `node <Skill base>/bootstrap.mjs --dir <absolute-target> --dry-run` and review every planned item. Stop on any conflict. With no conflict, run the same command without `--dry-run`. Use the Skill-distributed bootstrap; the AKE source-checkout CLI is for AKE development/testing, not target-project operations. Bootstrap uses offline Skill resources and does not create or upgrade a project-local CLI. Do not treat `.ake/tools/` presence as a reason to install/upgrade a CLI.
3. **Handle a non-Git target only through the full Skill consent flow.** Only the stable `NOT_GIT_WORKTREE` result from bootstrap or preflight is eligible; missing Git, a bare repository, permission error, damaged metadata, other status failure, or unknown result is not. Then run the Skill's read-only `init-git.mjs --inspect --dir <absolute-target>` and obtain its canonical path and directory identity. In Agent Teams only the Lead asks the user and runs the helper: use a host-native choice when available; plain-text options are allowed only if that capability is unavailable, never to bypass an explicit policy/permission denial. Show the exact canonical path. Only an explicit user selection of “initialize this target” (or exact-path text reply `1` when native choice is unavailable) authorizes continuation; refusal, skip, missing, ambiguous, or any other reply is not consent and ends Git initialization for this task. If another path is chosen, inspect it and obtain a new path-specific choice. After authorization, the Lead must independently inspect again and directly invoke the helper using that fresh canonical path and identity; never transfer the user's choice or helper execution to a child Agent. Use one writer only. Identity rechecks narrow but cannot eliminate the external TOCTOU race because Git has no atomic create-only init. A nonzero exit, signal, failed post-check, or uncertain result stops the process: retain state, do not retry, clean up, apply AKE changes, or continue the AKE operation; report for manual inspection. Git init may create templates/default settings as well as metadata; it does not add, commit, or push.
4. **Review initialization outcomes.** `created`, `identical`, `skip`, and `conflict` describe plan items. Existing differing files remain conflicts. When `AGENTS.md` is absent, initialization creates it. When an existing `AGENTS.md` is unmarked, initialization appends the marked trigger block while preserving the original bytes; it is not byte-identical afterward. Malformed or differing marked blocks conflict and are not overwritten. Review the plan/output rather than assuming the original whole file remains unchanged.
5. **Run project operations through the shared CLI.** Resolve `<Skill base>/resources/ake-source/scripts/ake.mjs` from the loaded Skill and pass `--project <absolute-target>` on each operation. For example:

   ```bash
   AKE_CLI="<Skill base>/resources/ake-source/scripts/ake.mjs"
   PROJECT="/absolute/path/to/project"
   node "$AKE_CLI" validate --project "$PROJECT"
   node "$AKE_CLI" search "connection pool timeout" --project "$PROJECT" --json
   ```

   Before an option-bearing read-only search, inspect this CLI's `--help` in the same cwd/env. Verify that each requested flag and value form is explicitly declared, including `--project DIR` and `--json` when used. If help cannot be read/parsed or a required option is not declared, do not run search, remove flags, guess, or retry. Run a supported search once and retain its raw query/options, filters, roots, coverage, reasons, truncation, and results; verify returned filters against requested `--type`/`--status`. Do not use help as proof that the command's runtime behavior is safe or correct.
6. **Keep project data and Skill updates separate.** The project owns its config, knowledge, candidates, and publish ledger. Legacy `.ake/tools/` is ignored: never inspect, execute, overwrite, copy into, or auto-upgrade it. Update the installed Skill only through its supported `ake update` process; pause operations using the Skill during its non-atomic in-place update. External scripts that used old copies require operator-reviewed migration to the shared CLI.

## Verification

- For an initialized project, preflight returns `PROJECT_OK` only when the shared CLI's absolute reported `project` resolves to the requested target; if the target/context changes, repeat identity validation.
- Run actual validation or requested task operation with the same cwd/env and explicit `--project`; do not infer operation support from preflight.
- The initialization plan reports conflicts rather than silently replacing existing files. Check the actual `AGENTS.md` result: an unmarked pre-existing file receives an appended block, while its original bytes are preserved as a prefix.
- Project initialization does not install/update Skills; Skill installation does not prove the Skill was loaded. For DSH use, ensure the Skill is available under the configured filesystem Skill provider root.

## Related

- [AKE README installation and migration](../../README.md#updates-and-migration)
- [AKE Skill](../../skills/ake/SKILL.md)
- [Retrieval and capture workflow](agent-task-knowledge-workflow.md)
