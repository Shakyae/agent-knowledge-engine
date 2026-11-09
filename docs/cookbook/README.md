# Cookbook — verified, repeatable procedures

Each recipe is a procedure that was actually executed in this repository and can be repeated: when to use it, the steps, and how to verify the result. Recipes are not design rationale ([Agent Notes](../../.agents/notes/README.md)) and not review rules ([defensive patterns](../defensive-patterns/README.md)).

In-file format: an H1 title, `## When to use`, `## Steps` (numbered), `## Verification`, plus the `ake:` frontmatter block that records applicability (`scope`), traceable `evidence`, and `verified` date or `pending`. Mark a recipe `verified: pending` until the listed verification was really executed against the current tool.

Validate with `node scripts/ake.mjs validate`; retrieve with `node scripts/ake.mjs search <terms>`.
