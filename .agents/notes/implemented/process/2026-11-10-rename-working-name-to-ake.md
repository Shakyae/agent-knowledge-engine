# Agent Note: Rename the working name to AKE and the CLI to `ake`

Status: implemented

## Problem

The project was developed under the abbreviation `PKO`, taken from an earlier title (`project-knowledge-ops`) that was abandoned while the product became **Agent Knowledge Engine**. The CLI also used `kno`, an ad-hoc shorthand for "knowledge ops" that was unrelated to the product name. Three names were circulating for one thing: `PKO` in the contract, `.pko` on disk, `kno` at the command line, and "Agent Knowledge Engine" in the title. A delivered project with a discarded abbreviation in its directory names, frontmatter keys, CLI and documentation is a defect of its own: every future reader has to learn what the names mean and which one is authoritative.

## Decision

One name, one abbreviation, everywhere:

- **Project**: Agent Knowledge Engine, abbreviated **AKE**.
- **CLI**: `ake`, installed as `<target>/.ake/tools/scripts/ake.mjs`; npm `bin` and scripts expose `ake`.
- **On disk**: `.ake/` for config, candidates and the publish log; `.ake/tools/` for the installed CLI.
- **Machine metadata**: the frontmatter block is `ake:` (was `pko:`), and the candidate record key is `akeCandidate:`. The values, ids and directory layout of the four knowledge kinds are unchanged.
- **Code**: `scripts/ake.mjs`, `src/lib/*.mjs` keep their responsibilities; only names and literal paths changed.
- The Skill keeps the functional name `knowledge-ops` — it names a capability, not the project.

The working name is retired, not aliased: there is no compatibility shim for `.pko/` configs or `pko:` frontmatter, because no released version ever shipped under that name. Renaming the project is a naming change, not a behaviour change; the contract in [architecture.md](../../../../docs/architecture.md) is otherwise unchanged and all gates keep the same semantics.

## Alternatives considered

**Keep `PKO` and only rename the CLI.** Rejected: the user-visible name of the project would still be a discarded abbreviation, and `.pko/` would keep teaching it to every reader.

**Rename the project but keep `kno` as the command.** Rejected: a command unrelated to the project name is the exact confusion that prompted this change; the cost of renaming it is a mechanical find-and-replace, the cost of keeping it is permanent.

**Ship a compatibility shim for `.pko/` and `pko:` frontmatter.** Rejected: nothing was released, so a shim would add a permanent code path for a name that has no users.

**Rename the Skill to `ake-knowledge-ops`.** Rejected: the Skill describes a capability and may be reused by projects that do not call the tool AKE; its name stays functional.

## Consequences

The rename is mechanical but total: 48 tracked files, the CLI entry file, the config directory and the retained scratch directory changed name. Historical audit reports in `docs/reviews/` were renamed with the same rules so that their links resolve, and `docs/reviews/README.md` records that this was a mechanical rename with unchanged conclusions. The gitignored `.ake-tmp/` snapshots were produced by the pre-rename CLI and are kept only as raw evidence of the runs described in the test report. Tests were re-run after the rename: 59/59 pass and `ake validate` reports 0 errors, so the change is name-only in effect.
