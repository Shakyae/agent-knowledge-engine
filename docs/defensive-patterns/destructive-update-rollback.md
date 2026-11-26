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

## Preserve state for manual recovery

Require a maintenance window: the user stops other AKE writers throughout the update. The cooperative lock does not constrain other programs and in-place installation is not atomic. If the installer may have started and fails or its result is uncertain, retain the live state and verified backup; do not automatically restore, clean up the backup, or blindly retry. Keep writers stopped, inspect the manifest and backup data against the live tree, links and lock, save a separate copy of the live state, and reconcile manually only after reviewing the differences and backup integrity.

**Prevents:** automatic recovery overwriting changes whose origin cannot be established.

**Reviewer check:** simulate installation failure and concurrent changes; verify the live state and backup are retained without recovery or cleanup, and the report identifies the backup and manual recovery steps.

**Boundary:** isolated tests simulate failures; they do not prove crash recovery or coordination with non-cooperating writers. Backup consistency is not authentication.

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
