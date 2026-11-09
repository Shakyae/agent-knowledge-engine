# Independent review reports

`review-1.md` … `review-4.md` are the audit records of the v0.1 acceptance rounds, produced by an independent reviewer that did not write the implementation. They are kept as evidence, not as current design authority; the current contract is [architecture.md](../architecture.md) and the current results are in [test-report.md](../test-report.md).

Two mechanical notes about this directory:

- The reports were written while the project still carried its working name. After the rename (see `.agents/notes/implemented/process/2026-11-10-rename-working-name-to-ake.md`) the names were replaced mechanically (`PKO` → `AKE`, `.pko` → `.ake`, `kno` → `ake`) with equal-length substitutions, so file line numbers, findings text and conclusions are unchanged.
- Temporary directory names quoted in the reports were names of disposable `os.tmpdir()` projects that no longer exist; they may appear in the reports in their pre-rename form where they were quoted from command output.
