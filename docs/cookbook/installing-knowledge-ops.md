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
- The target path is a valid Git working tree (a subdirectory of a repository is fine; linked worktrees and unborn branches are fine). No prior/first commit is required to initialize it; committing the AKE installation afterward is an optional project-maintainer action.
- A copy of this repository (installed project CLI copies are not init sources).
- For a truly non-Git target, direct `ake init` and bootstrap dry-run still refuse. Only the loaded AKE Skill may request initialization after `init-git.mjs --inspect` confirms a non-repository and displays the canonical path. In a Team, only the Lead asks the user: use host-native initialize/skip/choose-another/cancel choices when available; only if the host lacks native-choice capability, the Lead shows the exact path and plain-text options `1 — initialize this target and continue` / `2 — do not initialize yet`. An explicit host/system policy or permission denial of user interaction is not a fallback trigger and must not be bypassed through text. Only the user's explicit reply `1` to that path-specific prompt authorizes initialization. Child Agents neither ask the user nor run `init-git.mjs`; they report the target/status and wait. The Lead freshly inspects the target and directly runs the helper after receiving the user's explicit target-specific `1`, without relaying that consent or execution to a child Agent. Refusal/`2` is terminal for Git initialization during that task; empty, missing, ambiguous or any other reply does not authorize initialization. Choosing another target requires fresh inspection and a new choice. `init-git.mjs --inspect` binds the later call to device/inode/birthtime identity; this is path matching, not consent. The helper requires a single writer and rechecks immediately before Git init, but cannot eliminate an external TOCTOU race because Git has no atomic create-only init option. Git may create default configuration and copy templates, so do not claim an only-`.git` write set. If neither native nor Lead text interaction can obtain a clear user choice, do not initialize. The helper does not add/commit/push AKE content.
- Install the Skill separately and review migration precautions in the [README](../../README.md#updates-and-migration); init does not install Skills.

## Steps

1. Review the plan without writing anything:
   `node scripts/ake.mjs init --dir <target> --dry-run`
2. Read the plan: every item is reported as `created`, `identical`, `skip` or `conflict`, each with a path. Stop and reconcile any `conflict` before continuing.
3. Apply the plan: `node scripts/ake.mjs init --dir <target>`
4. For an existing unmarked `AGENTS.md`, init appends the marked block by default while preserving original bytes; review the planned changes. Differing or malformed existing marker blocks conflict without overwrite. `.ake/AGENTS-fragment.md` is also provided. `--merge-agents` remains accepted for compatibility.
5. Optional, after initialization: if desired, commit the installation in the target project: `git add .agents docs .ake AGENTS.md && git commit`. This is not a prerequisite for initialization; an unborn branch is valid.
6. Confirm the gate works in the target: `node .ake/tools/scripts/ake.mjs validate` and `node .ake/tools/scripts/ake.mjs search "any known topic"`.

## Verification

- `node .ake/tools/scripts/ake.mjs validate` exits 0 (index pages only, no knowledge documents yet).
- A second `init --dry-run` reports only `identical`/`skip` and no `created`.
- `git -C <target> status --short` shows only the files the plan listed.
- The pre-existing `AGENTS.md` (if any) is byte-identical to the pre-install copy (`git diff --stat` shows no change to it).

## Related

- [Conservative project initialization](../../.agents/notes/implemented/process/2026-11-09-conservative-project-init.md)
- [Retrieval and capture workflow](agent-task-knowledge-workflow.md)
