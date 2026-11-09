# AKE v0.1 独立复审 3

**结论：仍需修复后复审，不放行。** 仅复核 [review-2](review-2.md) 剩余项及对账回归；真实进程崩溃、全平台与身份核验仍未验证。

## 修复结论
- **P1-A FIXED（目标末次重读）**：[publish.mjs:35–37](../../src/lib/publish.mjs#L35-L37) 调用持久失效；独立复跑 `node --test --test-name-pattern='last target reread drift|bytes-identical update|diagnostic lines include' tests/unit/publish.test.mjs tests/unit/documents.test.mjs` → 3/3 pass。测试在第二次读取前写真实漂移，验证磁盘 submitted、reviews 空、approval null、invalidations 非空，恢复后仍拒绝且目标未写。
- **P1-B PARTIAL**：同字节 update 的普通重放被 marker 阻断；独立真实 CLI 用账本目录故障得到 unknown，普通 publish exit 1；目标不匹配时 `--reconcile` exit 1、marker 未消失；恢复正确正文后 reconcile exit 0、账本 `reconciled:true`。代码仅在正常 publish 路径写目标，[publish.mjs:11](../../src/lib/publish.mjs#L11) 对账不写目标；但崩溃窗口产生重复账本行，见新 P1-D。`--dry-run --reconcile` 互斥代码存在；真实崩溃未测试。
- **P1-C FIXED（指定反例）**：独立 `validateDocument` 对原始第 13 行空 `**Prevents:**` 返回 line 13；implemented Note 反例 `## Proposal` 实际第 17 行，返回 line 17。仅验证这两个定位，未全面证明所有 Markdown 行号。
- **P1-1 FIXED（指定反例）**：`node scripts/ake.mjs search knowledge --limit 0` → `coverage incomplete ...`、`No results displayed: --limit 0 truncated ... matches may exist`；`search zzunmatchable873924` → 原 `No matching knowledge found ...`；均 exit 0。
- **P1-6 PARTIAL**：[test-report.md](../test-report.md) 已存在，五级证据、编号及未验证项均可读；但第 31 行称“Every test creates a real Git repository ... runs the CLI as a subprocess”，[cli.test.mjs:10,12](../../tests/integration/cli.test.mjs#L10-L12) 的 help/no-root 测试并不创建仓库，属过度概括。第 144 行称 linked worktree 有 `.git`-file 单测，当前测试未见此断言；请修正文案或补证据。真实会话/团队叙述本轮未逐事件审计。

## 新增 P1-D：对账重复记录已完成的账本行
[publish.mjs:10–11](../../src/lib/publish.mjs#L10-L11)、[publish.mjs:42–43](../../src/lib/publish.mjs#L42-L43)：正常发布先 append 普通账本行，再持久化 published；若二者之间中断，marker 与普通账本行共存。`ledgerHasReconcile` 只识别 `reconciled:true`，再 `--reconcile` 会把同一次发布记第二行。与 §6 成功追加一行、结果可人工对账的目标冲突；并发或恶意写不在复现前提内。
独立模拟：真实 CLI 产生 marker 和目标后，将 marker 快照还原并将一条等字段账本行去掉 `reconciled`，模拟上述中断后的精确盘面；`node "$K" publish C-0001 --project "$T" --reconcile` exit 0，读取 JSONL → `ledger entries=2 [false,true]`。这是**盘面模拟而非真实进程崩溃**。建议引入稳定的发布尝试 ID（含在 marker 与两种账本行），匹配既有普通行时仅恢复候选状态；校验损坏/部分行并注入 append 后状态保存失败。未发现 reconcile 写目标的代码路径；不宣称对账具备排他锁。

## 独立执行证据
- `npm test` → `tests 58; pass 58; fail 0`；`node scripts/ake.mjs validate --project .` → `0 errors, 0 warnings`，exit 0。不是 clean checkout。
- 临时真实 Git 仓库 `T=/var/folders/4h/9g7lzjcn23d0vd44jf5_mv0r0000gn/T//ake-r3-gKxM3s`，`K=<本仓绝对路径>/scripts/ake.mjs`；`git -C "$T" init -q; node "$K" init --dir "$T" --json` 后，用合法 cookbook 依次 `candidate new --kind cookbook --title Three --author alice --target docs/cookbook/three.md --body "$T/body.txt"`、`candidate submit C-0001`、`review C-0001 --reviewer bob --verdict approve --notes checked`、`approve C-0001 --by human --confirm`，各加 `--project "$T"`，均 exit 0。
- `mkdir "$T/.ake/publish-log.jsonl"; node "$K" publish C-0001 --project "$T"` → `publish result unknown ... EISDIR`，exit 1；再次普通 publish → `publish result unknown from previous attempt`，exit 1。`rmdir` 该已核对的临时目录后修改目标为 `drift`；`publish C-0001 --project "$T" --reconcile` → `target does not match pending contentHash`，exit 1；`candidate show` 和后续成功对账证实 marker 保留。
- `cp "$T/body.txt" "$T/docs/cookbook/three.md"; node "$K" publish C-0001 --project "$T" --reconcile` → `reconciled publication ... ledger updated`，exit 0，账本 1 行且 `reconciled:true`。再构造上述中断盘面，结果见 P1-D。临时路径清理前已核对 `ake-r3-*` 前缀；未更改被审实现、未安装依赖或 commit。
- 冻结契约 §6 当前仍写“未知结果人工对账、禁止自动重放”，`--reconcile` 为新公开接口；须由 Lead 确认该受限显式恢复的契约修订，而非默认为冻结接口已变更。

## §9 逐项结论
1. **未验证**：现有树测试 58/58、validate 0/0，但非 clean checkout。
2. **PASS（既有测试证据）**：真实 Git init/重复运行；只以 porcelain 而非全文件字节快照验证不变。
3. **PASS（既有测试证据）**：预置 AGENTS/index 冲突并保留字节，允许安全项创建。
4. **FAIL**：review-2 的原漂移/盲重放反例已阻断，但新增 P1-D 使故障恢复账本不唯一，需修复复审。
5. **PASS（有限范围）**：列明的门禁反例有测试，DP/Note 指定行号已核实；不代表语义正确或全部 Markdown 兼容。
6. **未独立验证**：[test-report.md:85–93](../test-report.md#L85-L93) 及 Lead 提供了演化与相似度观察，本轮未独立执行/核查完整原始事件；不能将转述升级为独立 PASS。
7. **PASS（既有测试证据）**：复制 CLI 在无 package.json/CommonJS 与不同 cwd 运行；其余平台未验证。
