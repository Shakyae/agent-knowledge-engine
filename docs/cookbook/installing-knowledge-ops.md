---
ake:
  type: cookbook
  id: CB-installing-knowledge-ops
  status: active
  created: 2026-11-09
  scope: ["a target Git project that will use AKE"]
  evidence: ["docs/test-report.md", "tests/integration/init.test.mjs"]
  verified: 2026-11-09
---

# Install knowledge ops into an existing project

## When to use

You want a Git project (new or existing) to gain the four knowledge directories, the Knowledge Ops Skill and the self-contained `ake` CLI, without AKE overwriting anything the project already has.

## Prerequisites

- Node.js >= 20 and Git available.
- The target path is a valid Git working tree (a subdirectory of a repository is fine; linked worktrees are fine).
- A copy of this repository (installed project CLI copies are not init sources).
- Install the Skill separately and review migration precautions in the [README](../../README.md#updates-and-migration); init does not install Skills.

## Steps

1. Review the plan without writing anything:
   `node scripts/ake.mjs init --dir <target> --dry-run`
2. Read the plan: every item is reported as `created`, `identical`, `skip` or `conflict`, each with a path. Stop and reconcile any `conflict` before continuing.
3. Apply the plan: `node scripts/ake.mjs init --dir <target>`
4. If the target already had an `AGENTS.md`, the command leaves it untouched: merge `.ake/AGENTS-fragment.md` by hand. Only pass `--merge-agents` when you want the marked block appended automatically.
5. Commit the installation in the target project: `git add .agents docs .ake AGENTS.md && git commit`.
6. Confirm the gate works in the target: `node .ake/tools/scripts/ake.mjs validate` and `node .ake/tools/scripts/ake.mjs search "any known topic"`.

## Verification

- `node .ake/tools/scripts/ake.mjs validate` exits 0 (index pages only, no knowledge documents yet).
- A second `init --dry-run` reports only `identical`/`skip` and no `created`.
- `git -C <target> status --short` shows only the files the plan listed.
- The pre-existing `AGENTS.md` (if any) is byte-identical to the pre-install copy (`git diff --stat` shows no change to it).

## Related

- [Conservative project initialization](../../.agents/notes/implemented/process/2026-11-09-conservative-project-init.md)
- [Retrieval and capture workflow](agent-task-knowledge-workflow.md)
