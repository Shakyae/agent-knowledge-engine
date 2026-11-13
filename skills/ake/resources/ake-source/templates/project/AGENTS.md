<!-- ake:begin -->
# AKE Knowledge Operations

- For implementation, architecture, debugging, testing, deployment, or risk changes, retrieve applicable knowledge from `.agents/notes/`, `docs/defensive-patterns/`, `docs/postmortem/`, and `docs/cookbook/` before work.
- Knowledge is organized by kind and lifecycle; when a task makes relevant knowledge useful, use the visible `ake` Skill and retrieve it on demand before work.
- Make retrieval and capture visible before the first related AKE CLI action; coalesce consecutive same-stage calls into one notice. In Agent Teams, the Lead/owner sends one unified user notice; members report to the Lead and do not repeat it. Identify the relevant Note, Defensive Pattern, Postmortem, or Cookbook category and summarize applicable hits. Prefer an eligible independent Team reviewer; in Single Session explicitly record the actual author self-review, never as independent. After the review gate, local automatic authorization and publishing are the default; use human authorization only when explicitly requested. If there is no new knowledge, report `AKE · 本次无新增知识`; disclose any un/published candidate and why it remains pending.
- These instructions are soft constraints, not security isolation: ordinary file tools can bypass them and declared identities cannot be independently verified by AKE.
<!-- ake:end -->
