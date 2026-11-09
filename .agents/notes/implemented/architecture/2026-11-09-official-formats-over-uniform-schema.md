# Agent Note: Reuse the official four knowledge formats instead of inventing a uniform schema

Status: implemented

## Problem

A project knowledge system must be readable by humans, checkable by a small tool, and compatible with knowledge already written under the DSH conventions. A tempting shortcut is one uniform schema for everything: same frontmatter, same `proposed`/`implemented` lifecycle, same section names. That schema is convenient for the tool and wrong for the knowledge: an Agent Note's lifecycle, a post-mortem's incident record, a defensive pattern's review rule and a cookbook's procedure are different facts with different obligations. A uniform schema also breaks the official Agent Note file format, whose first three lines are fixed and whose lifecycle is encoded in the path.

## Decision

Keep the official format of each kind as the human authority, and add the smallest machine layer that does not contradict it.

- **Agent Notes** keep the official path tree `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md` (class ∈ feature, bug-fix, simplification, architecture, process, testing) and the official three-line header, `## Problem` opener, mandatory `## Alternatives considered`, and lifecycle sections. They carry **no** frontmatter, so the fixed header stays intact.
- **Post-mortems** keep the four-digit H1 and a free-form `Status:` line; required sections are `Executive summary`, `Summary`, `Impact`, `Timeline`, `Root cause […]`, `Guardrails […]`.
- **Defensive patterns and cookbooks** have no official machine-readable status, so they carry a minimal `pko:` frontmatter block (type, id, status, created, scope, evidence) — the only addition. Defensive rules additionally label `**Prevents:**`, `**Reviewer check:**`, `**Boundary:**` so that structure is checkable while their content stays prose.
- The machine layer never overrides the body: a disagreement between frontmatter and body/path is reported as a validation error. Missing scope/evidence for notes is reported as `unknown`, never invented.
- `README.md` inside a knowledge root is an index page, skipped by validation and search.

See [architecture.md](../../../../docs/architecture.md) §4 for the frozen rules.

## Alternatives considered

**One uniform frontmatter schema for all four kinds (including Agent Notes).** Rejected: it contradicts the official note header, and it forces a `proposed`/`implemented` lifecycle onto cookbook and post-mortem documents, where "implemented" means nothing.

**Notes-only system plus free-form directories for the rest.** Rejected: without a status/scope/evidence layer, retrieval cannot show applicability and the publish gate cannot check the document it is about to write.

**Reproduce the full official apparatus (bilingual triplets, sidecars, archived tree, `doc-sync` gates).** Rejected for v0.1: the maintenance cost and bilingual obligations exceed the MVP, and a target project should not need them to keep useful knowledge.

## Consequences

The validator special-cases Agent Notes, which is a small amount of type-aware code instead of one generic pass. Notes cannot carry machine-readable scope, so retrieval reports `unknown` for them and the reader must judge applicability from the note body. Target projects get one extra metadata block only for the two kinds that otherwise have no status at all.
