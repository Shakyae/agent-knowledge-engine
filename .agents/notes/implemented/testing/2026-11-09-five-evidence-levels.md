# Agent Note: Report verification in five evidence levels, never one "integration passed" claim

Status: implemented

## Problem

The research this project builds on repeatedly hit the same failure: a mechanism's *existence* (a skill directory, an AGENTS rule, a task board) was reported as evidence that a capability *worked*. For a knowledge system the interesting claims are behavioural — did a fresh session find and apply the knowledge, did a different agent review independently, did the gate really refuse — and none of those follow from a mock or a path check.

## Decision

Every test report separates five levels, and no level is allowed to stand in for another:

1. unit tests (`node:test`) over pure logic;
2. isolation-project integration tests: real temp Git repositories, real `git` subprocesses, real CLI subprocesses;
3. real DSH Single-Session runs (fresh agent, no shared history) — record searches performed, hits, applicability judgement and application;
4. real DSH Agent Teams runs — independent reviewer, designated publisher, withheld human authorization;
5. unverified behaviour, listed explicitly and never counted as passing.

Boundary claims are cited by stable ids: `P-PROMPT-1/2` (prompt-level soft rules), `P-CHECK-1/2` (what the CLI can actually inspect), `P-UNVERIFIED-1…4` (identity, skill loading, retrieval quality, platform/crash-recovery assumptions).

## Alternatives considered

**A single "integration tests passed" line.** Rejected: it is exactly the ambiguity this project exists to remove, and it invites simulated agent calls to be reported as real DSH integration.

**Only unit tests, treating behaviour as out of scope.** Rejected: the product claim is behavioural (retrieval and reuse), so at least one real fresh-agent and one real team run are required for any honest v0.1 statement.

## Consequences

The report is longer and will honestly contain "unverified" rows, including claims about retrieval recall, adherence and identity that v0.1 cannot test at scale. Real-session runs cost model calls and need a writable isolated project, so they are few and recorded as single observations rather than statistics.
