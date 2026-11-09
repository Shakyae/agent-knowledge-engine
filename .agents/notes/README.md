# Agent Notes — layout and rules

An Agent Note records a decision (or a proposal) about this repository: the *why* and *what was given up*, which code and tests cannot carry.

Layout: `.agents/notes/{proposed,implemented,rejected}/{class}/yyyy-mm-dd-topic-title.md`, class ∈ `feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`. Status is encoded twice — in the `Status:` line and in the lifecycle folder — and both must agree.

In-file format: the first three lines are exactly `# Agent Note: <title>`, a blank line, `Status: <value>`. The body opens with `## Problem`, and `## Alternatives considered` is mandatory. `proposed` adds `## Proposal`, `## Acceptance criteria`, `## Risks`; `implemented` adds `## Decision`, `## Consequences` and must not keep proposal-era headings; `rejected` keeps the proposal and states the reason on the `Status:` line.

Rules: update the note that owns a decision instead of creating a duplicate; never edit an implemented note into a different decision — supersede it with a new note and cross-link both; no centralized index (the path is the index). This MVP does not implement the official bilingual triplets or the archived tree.

Validate with `node scripts/kno.mjs validate`; retrieve with `node scripts/kno.mjs search <terms>`.
