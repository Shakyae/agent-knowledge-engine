# Legacy AKE CLI compatibility fixture

This fixture contains `scripts/ake.mjs` and the complete `src/lib/` tree from source commit `720b2e85e969304079e9ac3a3d8ecbcc7331ff92` (the pre-feature `master` tip used for the merge). The code is equivalent to that source; only whitespace was normalized for `git diff --check`: one trailing space was removed from `src/lib/git-remote.mjs`, and one extra blank line at EOF was removed from `src/lib/installation.mjs`. The fixture is kept in-tree so integration tests do not depend on `.git` history, branch names, shallow-clone depth, or source archives containing Git objects.

The fixture intentionally preserves the old CLI argument parser, which accepts unknown `--status` and `--budget-bytes` flags but does not apply them. It is test data only; do not use it as a supported project CLI.
