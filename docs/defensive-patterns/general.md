---
ake:
  type: defensive-pattern
  id: DP-general
  status: active
  created: 2026-11-09
  scope: ["src/lib/", "scripts/", "skills/", "templates/"]
  evidence: ["tests/unit", "tests/integration", "docs/test-report.md"]
  verified: 2026-11-09
---

# General defensive patterns

## Fail closed when authorization cannot be verified

A publish path may proceed only when every required fact is present and recomputable: approved status, an approval bound to the current content, an approving review bound to the same content from a declared author other than the candidate author, unchanged target bytes and a valid resulting document. If any fact is missing, ambiguous, unreadable or mismatched, refuse and name the concrete reason. "Unknown" is never treated as success.

**Prevents:** publishing knowledge after authorization silently went stale, or when the tool could not actually tell whether it was authorized.

**Reviewer check:** read the publish path and list each precondition; for each one, ask "what happens when this input is missing, unreadable or changed?" Every answer must be a refusal with a specific message and no partial write.

**Boundary:** only operations that go through the CLI. The declarer of `--by`/`--reviewer` is not a verified identity, and ordinary file tools can edit formal knowledge outside the CLI — see the boundary claims in the test report. Exceptions: none in v0.1.

```ts
// correct: refusal is the default, success must be earned
const bound = reviews.filter((r) => sameBinding(r, candidate.binding))
if (bound.length === 0) return refuse('no review bound to this content; re-review required')
```

```ts
// wrong: the happy path is assumed and stale records are silently forgiven
if (candidate.approval) publish()   // never checks what the approval was bound to
```

## Bind the target, not just the candidate

An approval or review must bind the candidate content **and** the target path, the target bytes and the operation. Recompute the target hash immediately before writing, and refuse when it changed. A target that must be created cannot suddenly exist; a target that must exist cannot disappear.

**Prevents:** approving document A and then overwriting the user's edited version of the target file, or writing into a different path than the one reviewed.

**Reviewer check:** grep every place that writes a formal document; each must compare a freshly computed target hash with the reviewed binding, and each refusal must be reproducible by editing one byte of the target.

**Boundary:** the re-check detects drift observed before the write; it does not exclude a writer that changes the file after the check (TOCTOU). No filesystem lock is claimed.

```ts
// correct: observe, compare, then write
const actual = await sha256File(absTarget)            // 'absent' when missing
if (actual !== candidate.targetHash) return refuse('target changed; re-review required')
await writeAtomic(absTarget, body)
```

```ts
// wrong: trust the snapshot taken when the candidate was created
await writeFile(target, body)   // silently overwrites whatever is there now
```

## Report "not found", never "does not exist"

Retrieval and validation report what they actually covered. A zero-hit search says no matching knowledge was found in the searched scope; it never claims the knowledge does not exist. Unreadable files, missing roots, skipped entries and truncated results are reported as coverage conditions for every run, including runs that produced hits.

**Prevents:** an agent concluding "there is no relevant knowledge" because a root was missing, a hidden directory was not scanned, or a result list was truncated.

**Reviewer check:** run a search in a project with a temporarily unreadable file and a deliberately tiny `--limit`; both outputs must carry `coverage: incomplete` and a reason, and the no-hit message must use "not found in the searched scope".

**Boundary:** coverage statements describe this process's observed access, not the repository's true contents; an absent root is reported as "not installed (treated as confirmed empty)".

```ts
// correct: scope and reasons travel with the result
return { results, coverage: reasons.length ? 'incomplete' : 'complete', coverageReasons: reasons }
```

```ts
// wrong: silent fallback that turns a read failure into "no knowledge"
try { hits = scan(roots) } catch { return [] }   // and the caller prints 'no knowledge found'
```

## Invalidate authorization when a violation is observed

Once a tool or reviewer observes that a candidate's binding no longer matches (content, target path, operation or target bytes), the prior reviews and approval are dead. Persist the invalidation in the record and require a fresh review; never recompute the comparison on the next run and quietly revive an authorization because the bytes were restored afterwards.

**Prevents:** an authorization that survived a detected violation, letting a restored file or a later rerun publish content whose review had already expired.

**Reviewer check:** for each gate that can observe drift, confirm the refusal path writes the invalidation (and its reason) to persistent state, and that a second run after restoring the old bytes still refuses with the re-review message.

**Boundary:** bytes changed and restored before the tool ever looked are undetectable; that is the TOCTOU limit, not a guarantee. Invalidation is persisted only for observations the tool actually made.

```ts
// correct: observe drift, persist the invalidation, then refuse
if (observed !== bound) {
  record.invalidate({ reason: 'target changed', observed })
  await save(record)
  throw Error('previous review/approval invalidated by observed drift; re-review required')
}
```

```ts
// wrong: compare live hashes only, so restoring the bytes silently revives approval
if (sha(await read(target)) === record.targetHash) publish()
```

## Copy tools as `.mjs`, not `.js`

Modules installed into another project must be `.mjs`. A `.js` file inherits the target's `package.json` type, and a project without `type: module` parses it as CommonJS, so the first `import` fails. `.mjs` is ESM regardless of the target's package boundary, which also means AKE never has to modify the target's `package.json`.

**Prevents:** a freshly initialized project whose installed `ake` CLI crashes on import in an existing CommonJS repository.

**Reviewer check:** the integration suite initializes a target with no `package.json` (and one with `"type": "commonjs"`) and runs `node .ake/tools/scripts/ake.mjs validate` as a subprocess; it must exit 0/1 by validation, not by a module-resolution error.

**Boundary:** requires Node >= 20; nothing is claimed about older runtimes or other package formats.

```text
.ake/tools/scripts/ake.mjs          correct: ESM everywhere
.ake/tools/src/lib/search.mjs
```

```text
.ake/tools/scripts/ake.js           wrong in a CommonJS target: SyntaxError on import
```

## Prove the gate with real subprocesses

Every refusal claim in the test report must come from running the real CLI as a subprocess against a real temporary Git repository: real `init`, real candidate files, real `git` state. In-process fakes or mocked filesystems may test pure helpers, but they cannot support a claim that publishing is refused.

**Prevents:** a gate that "passes" because the test called the same helper the implementation calls, with inputs shaped to make it pass.

**Reviewer check:** for each refusal matrix row, find the test that spawns the CLI, creates the conflicting state on disk, asserts the non-zero exit code and the concrete message, and asserts that the target file is byte-identical afterwards.

**Boundary:** real-session and real-team behaviour still needs separate evidence; a passing subprocess test proves the CLI's own gate only.

```ts
// correct: real process, real files, assert nothing was written
const r = await runCli(['publish', id], { cwd: repo })
assert.notEqual(r.code, 0)
assert.match(r.stderr, /target changed since candidate creation/)
```

```ts
// wrong: the assertion reuses the implementation's own predicate
assert.ok(impl.canPublish(candidate))   // proves only that the helper agrees with itself
```
