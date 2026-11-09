# Agent Note: No vector index or MCP knowledge server in v0.1

Status: rejected — no measured retrieval gap yet, and the infrastructure would bind every consuming project to a service before the knowledge format itself is proven.

## Problem

Keyword search over a Markdown knowledge base can miss semantically related knowledge: a task about "connection pool exhaustion" will not match a note titled "socket leak fix". A vector index or an MCP knowledge server would plausibly mitigate that, and is a familiar next step for any knowledge product.

## Proposal

Add an embedding index or an MCP server that serves knowledge to agents, replacing the CLI keyword search in v0.1.

## Alternatives considered

**Ship it now, measure later.** Rejected: the research found no evidence that keyword retrieval fails on a project-sized knowledge base, while the cost is real — an embedding provider, an index to keep current, a service to run, and a deployment story for every target project. It also contradicts the MVP goal of portability, and would make "retrieval works" depend on infrastructure nobody has tested.

**Small, optional lexical improvement instead (synonym table, heading-aware scoring).** Accepted as the fallback if retrieval misses are observed in real sessions: no service, no dependency, measurable in the same tests.

**Keep keyword search and accept misses.** The current choice: `kno search` reports the searched scope and `coverage: incomplete` conditions honestly, and a miss is reported as "not found", which is actionable without new infrastructure.

## Consequences of the rejection

If real-session tests show recall failures that a synonym table cannot fix, revisit with evidence and a cost estimate. Until then, no vector store, no MCP server and no background service is part of PKO.
