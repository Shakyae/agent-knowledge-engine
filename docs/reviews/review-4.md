# AKE v0.1 最终聚焦复审 4

**结论：可放行 v0.1（范围限定如下）。** 本轮指定阻断项已修复；clean checkout、真实崩溃、其他平台等未验证项不计作通过，不阻断本次验收。`--reconcile` 相对冻结契约新增公开接口，建议 Lead 在提交时明确记录其裁决与使用边界。

## 最终复验
- **P1-D FIXED｜已有普通账本行**：[publish.mjs:10–24](../../src/lib/publish.mjs#L10-L24) 同时识别普通/对账行并无条件重读目标。真实 Git 仓库正常 CLI 创建、审核、授权后，注入第二次 `saveCandidateImpl` 失败，得到目标已写、普通账本一行、候选 pending（非真实崩溃）。修改目标后 `publish C-0001 --reconcile` exit 1、`target does not match pending contentHash`；marker=true、status=approved、账本 `cmp` 原样。恢复目标后同命令 exit 0 `publication already recorded in ledger; candidate state repaired`；账本逐字节未变、仍 1 行。再次 reconcile exit 1 `no pending publication to reconcile`。
- **P1-D FIXED｜账本缺失**：另建真实 Git 仓库，正常 CLI 授权后注入目标第三次读取失败，报 unknown，确认 ledger 不存在；`publish C-0001 --reconcile` exit 0，账本唯一行 `reconciled:true`；第二次 exit 1 `no pending publication to reconcile`，仍 1 行。独立构造初次测试曾因复用 ID 触发 collision，已在全新仓库修正后重跑，不将失败试验计为通过。
- **P1-A/C/1-1 FIXED（抽验）**：`node --test --test-name-pattern='last target reread drift|bytes-identical update|diagnostic lines include' tests/unit/publish.test.mjs tests/unit/documents.test.mjs` → 3/3；独立 Note 禁止 Proposal 错误定位第 17 行、DP 空标签定位第 13 行。`search knowledge --limit 0` 输出 `No results displayed ... matches may exist`，真实零命中仍输出 `No matching knowledge found`。
- **P1-6 PARTIAL，P2 文档准确性（不阻断）**：[test-report.md:31](../test-report.md#L31) 已缩小过度概括，但“search cases ... plain knowledge directories”不准确： [search.test.mjs:3](../../tests/integration/search.test.mjs#L3) 实际 `git init`；“Every test ... finally”不准确：该文件及 [tools.test.mjs:3](../../tests/integration/tools.test.mjs#L3) 使用 `t.after`，而 help 测试不创建临时目录。当前报告仍记 58/20 integration，现实测总数 59；建议提交前按实更新为 59/21，并精确写 `finally` 或 `t.after`。linked worktree 的所谓 `.git`-file 单测也尚无明确证据；未验证列表应避免声称已测。
- **测试结果**：`npm test` → `tests 59; pass 59; fail 0`；`node --test tests/unit/publish.test.mjs tests/integration/publish-gate.test.mjs` → 23/23；`node scripts/ake.mjs validate --project .` → `0 errors, 0 warnings`；均 exit 0。

## §9-6 独立读取留存证据
在 `.ake-tmp/lead-final`：① glob 架构目录仅 `2026-11-09-budget-observability.md`；② CLI `candidate list/show C-0002/show C-0003`：C-0002 revision 1、update、submitted、reviews=[]、approval=null、invalidations 非空；C-0003 同一目标 update、published；③ 直接读取 `.ake/publish-log.jsonl`：仅 C-0001 首次发布（reconciled:true）及 C-0003 更新，C-0002 无账本行；④ `validate` → 0 errors，`search "cancellation flag budget"` 命中该 note 和更新后的正文；⑤ `candidate check C-0004` → `overlap: 1`、建议更新已有文档。以上独立核实优先更新既有权威文档、未新增平行文档；失效持久化由 C-0002 盘面支持，**恢复原字节后仍拒绝**另由前轮独立动态实测和现有测试支持，非仅由当前快照推断。

## §9 验收
1. **部分验证**：当前树 59/59、validate 0；未 commit，clean checkout 未验证。
2. **PASS（现有集成证据）**：真实 Git 首次/二次 init；无写证明使用 Git porcelain，非全文件字节快照。
3. **PASS（现有集成证据）**：预置 AGENTS/index 冲突与保留原字节；其他安全项可创建。
4. **PASS（指定场景）**：端到端及拒绝矩阵、修订/漂移失效、对账三盘面有真实 CLI 或注入证据；真实进程崩溃和检查后 TOCTOU 不作保证。
5. **PASS（机器规则样本）**：各类指定负例有测试；机器结构检查不证明事实或内容质量。
6. **PASS（一次观察）**：上列五项证据支持就地演化及重复提示；相似性仅 advisory。
7. **PASS（现有集成证据）**：复制 CLI 在不同 cwd、无 package.json/CommonJS 下运行；其他平台未测试。

实验临时仓库为 `/var/folders/4h/9g7lzjcn23d0vd44jf5_mv0r0000gn/T//ake-r4-b0fFk2` 和 `/var/folders/4h/9g7lzjcn23d0vd44jf5_mv0r0000gn/T//ake-r4b-8PUlHX`，已核对 `ake-r4-*` / `ake-r4b-*` 前缀后清理；未修改被审实现、未安装依赖、未提交 Git。身份、权限隔离、真实人工授权、Node 20、Windows、linked worktree、真实崩溃及并发排他均未验证或不承诺。
