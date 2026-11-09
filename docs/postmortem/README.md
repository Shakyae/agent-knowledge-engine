# Post-mortems

A post-mortem records a failure that reached somewhere it should not have: what broke, the mechanism, why the safety nets missed it, and the guardrails added so this class of defect fails loudly next time.

Write one only when the defect was **subtle**, **systemic** (the escape was a gap in tests, tooling or conventions) and **costly to rediscover**. A plain bug fix belongs in a commit, a code-review rule belongs in [defensive patterns](../defensive-patterns/README.md), and a deliberate decision belongs in [Agent Notes](../../.agents/notes/README.md).

Required sections: `## Executive summary`, `## Summary`, `## Impact`, `## Timeline`, `## Root cause […]`, `## Guardrails […]`; the header is `# Post-mortem NNNN: <title>` followed by a free-form `Status:` line. Link the guardrails that now prevent recurrence.

No post-mortem has been recorded for AKE v0.1 yet.
