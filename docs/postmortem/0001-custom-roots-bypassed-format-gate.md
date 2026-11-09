# Post-mortem 0001: Custom knowledge roots silently disabled the document format gate

Status: resolved (fix verified in the v0.1 acceptance run)

## Executive summary

A candidate whose tooling had been pointed at custom knowledge roots published an invalid document and `validate` then reported zero errors. The type inference inside the validator matched files against hard-coded default directories; when a root moved, no type was recognized, and "no recognized type" was treated as "no errors" instead of an error. The gate therefore only protected projects that used the default layout. The fix resolves the document kind from the project's configured roots, fails closed when the kind cannot be determined, and adds regression tests for custom-root projects.

## Summary

During independent review, a test project configured `knowledgeRoots.cookbook` to `custom/recipes`, then submitted a one-line body (`this is invalid`) as a cookbook candidate. `candidate submit`, `review` and `approve` all succeeded, `publish` wrote `custom/recipes/bad.md` and exit 0, and `validate --project` still reported `0 errors, 0 warnings`. The gate had checked the document against zero rules because the validator could not map the path to a knowledge kind.

## Impact

Any team that reorganized its knowledge directories — the documented way to adopt AKE in an existing project — would have lost the entire format gate while every command kept reporting success. The damage is not data loss but silent false assurance: unpublished, unreviewable-quality knowledge would enter the formal library and every later `validate` would confirm it as clean.

## Timeline

- v0.1 implementation validated documents by matching repository-relative paths against the default roots (`.agents/notes`, `docs/defensive-patterns`, `docs/postmortem`, `docs/cookbook`).
- Independent review constructed a custom-root project and reproduced the full false-success chain (`submit` → `publish` → `validate`, all exit 0).
- Lead acceptance reproduced the same chain before the fix and confirmed `submit` refused afterwards (`custom/recipes/bad.md:1 missing YAML frontmatter`).
- Fix: `documentKind()` resolves the deepest configured root, ambiguity or no-match is a validation error, and every call site (`validate`, `candidate submit`, `candidate check`, `publish`) passes the same project configuration.

## Root cause

Two design mistakes combined. First, the validator derived document type from path constants instead of the configuration that the project actually uses, so configuration and enforcement disagreed. Second, the validator's contract was "return the list of errors found", and an unrecognized path had no rule to violate — an empty list. Fail-open is the default shape of a validator that only reports what it recognizes; the type had to become a required, explicit input instead of an inference.

## Guardrails

- [`validateDocument`](../../src/lib/documents.mjs) now requires the kind resolved from `projectRoot` + `config.knowledgeRoots`; unresolved or ambiguous → `cannot determine knowledge type for <path>`, exit 1.
- Regression coverage: custom-root cookbook / note / defensive-pattern / post-mortem cases in [`documents.test.mjs`](../../tests/unit/documents.test.mjs) and the real-CLI publish refusal matrix in [`publish-gate.test.mjs`](../../tests/integration/publish-gate.test.mjs).
- The independent review record with the original reproduction is kept at [review-1.md](../reviews/review-1.md); the re-check is [review-2.md](../reviews/review-2.md).
- Defensive rule: [fail closed when authorization cannot be verified](../defensive-patterns/general.md#fail-closed-when-authorization-cannot-be-verified) — the same fail-open shape is rejected there.
