---
akeCandidate:
  id: "C-0003"
  revision: 2
  kind: "defensive-pattern"
  title: "Destructive update and rollback data safety"
  author: "team-lead"
  created: "2026-11-14"
  status: "published"
  target: "docs/defensive-patterns/destructive-update-rollback.md"
  operation: "create"
  targetHash: "absent"
  contentHash: "65fbc8788337d8216fbcae0a1cefd2911f163bcfd935ef8b61223292acaf67b5"
  scope: ["src/lib/","scripts/"]
  evidence: ["src/lib/install-backup.mjs","tests/integration/update-flow.test.mjs","tests/unit/install-backup.test.mjs","docs/test-report.md"]
  reviews: [{"reviewer":"reviewer","mode":"independent","verdict":"approve","contentHash":"65fbc8788337d8216fbcae0a1cefd2911f163bcfd935ef8b61223292acaf67b5","target":"docs/defensive-patterns/destructive-update-rollback.md","targetHash":"absent","operation":"create","at":"2026-11-14T12:00:23.204Z","notes":"PASS WITH LIMITATIONS：revision 2 Boundary 明确 macOS 隔离真实文件系统与模拟安装失败，Windows 路径/锁和真实进程中断/崩溃恢复未验证；不协调忽视锁的进程、无法证明快照前未污染、manifest 非签名均已说明。核心主张有 A 级证据：install-backup.mjs 及对应测试，独立隔离复现并发文件/软链保留、lock 顶层漂移拒绝、manifest 漏项拒绝；candidate check 无错误及绑定漂移。general.md 重合度仅 advisory，主题不同，保留独立目标。本审核不授权发布。"}]
  approval: {"by":"shakya","mode":"human","at":"2026-11-14T13:39:21.538Z","contentHash":"65fbc8788337d8216fbcae0a1cefd2911f163bcfd935ef8b61223292acaf67b5","target":"docs/defensive-patterns/destructive-update-rollback.md","targetHash":"absent","operation":"create"}
  publication: {"at":"2026-11-14T13:39:21.613Z","contentHash":"65fbc8788337d8216fbcae0a1cefd2911f163bcfd935ef8b61223292acaf67b5","target":"docs/defensive-patterns/destructive-update-rollback.md","previousTargetHash":"absent"}
  supersededBy: null
---
<!-- body -->
---
ake:
  type: defensive-pattern
  id: DP-update-rollback-safety
  status: active
  created: 2026-11-14
  scope: ["src/lib/", "scripts/"]
  evidence: ["src/lib/install-backup.mjs", "tests/integration/update-flow.test.mjs", "tests/unit/install-backup.test.mjs", "docs/test-report.md"]
  verified: 2026-11-14
---

# Destructive update and rollback defensive patterns

## Restore only what the snapshot can account for

An update that replaces files in place must be able to undo itself from a recorded
snapshot. A rollback may therefore rewrite or delete only paths that the snapshot
actually captured: the installed tree, the links that existed before the update, and
the lock file's recorded bytes or recorded absence. Anything else that appears during
the update window may have been created by a concurrent user or a third-party tool.
The update process cannot prove who created it, so it must leave it untouched, list it
in the report, and treat the rollback as incomplete rather than silently "restoring" a
state that destroys it. The same rule applies to a lock file: compare the whole object
(ignoring only the entry this tool owns) and refuse to write the old bytes when any
other field drifted.

**Prevents:** a rollback that deletes a user's file, directory or symlink created while
the installer was running, or that overwrites concurrent changes to unrelated lock
entries because the comparison only looked at the tool's own subtree.

**Reviewer check:** for every path the restore path deletes or rewrites, ask "is this
path present in the snapshot taken before the update?" If the answer is not provably
yes, the operation must be a refusal with the exact path reported and the backup
retained. Then create a concurrent file, directory and symlink during a simulated
install failure and confirm all three survive the rollback.

**Boundary:** the check covers only the tool's own update window and its own recorded
snapshot. It cannot prove that pre-existing content was not already compromised, and it
does not coordinate with processes that ignore the tool's lock. A rollback that leaves
unknown entries in place reports itself as failed on purpose; an operator must review
the retained paths and the kept backup. Evidence comes from isolated macOS tests
(Node v26.13.0, real filesystem, simulated install failures); Windows path and locking
behaviour and real process interruption or crash recovery during an update were not
verified, so the rule is stated as a requirement rather than a property proven on every
platform.

## Validate a backup against its data tree, not only its manifest

A backup is only as trustworthy as the check that reads it back. Verifying the entries
listed in the manifest is not enough: a manifest can list a file whose bytes are absent,
and a data tree can contain files the manifest never recorded. Validation must compare
the manifest and the actual backup tree in both directions — path set, type, mode, hash
and link target — and reject the backup on any mismatch. A rejected backup must never be
used for restore and must never be pruned as a valid AKE backup.

**Prevents:** restoring from a partially written or silently edited backup, and pruning
based on a manifest that no longer describes what the directory contains.

**Reviewer check:** delete a manifest entry while keeping its data file, then edit a data
file without touching the manifest; both cases must be rejected as invalid backups, not
accepted as complete.

**Boundary:** this validates internal consistency, not authenticity. A backup that was
fully rewritten by another process, including its manifest, passes; the marker is not a
signature and the backup directory is not a security boundary.
