# PKO v0.1 独立复审 2

**结论：仍需修复后复审，不放行。** 原 [review-1](review-1.md) 保留历史；本报告只聚焦修复及相关回归。P0/P1 系验收分级，不声称安全隔离。

## 原问题修复结论
- **P0-1 FIXED（原复现）**：[documents.mjs:10–15](../../src/lib/documents.mjs#L10-L15) 根据配置最深匹配；临时 Git 项目 `cookbook=custom/recipes`、正文 `this is invalid`，`validate --path custom/recipes/validation.md` 与 `candidate submit C-0001` 均 exit 1、`missing YAML frontmatter`；强制构造绑定完整的 approved 记录后 `publish C-0001` 也因同一格式错误 exit 1，目标不存在。真实流程不能通过 submit，故不能自然走到 approve；这里是隔离测试中人工构造记录以触达 publish 格式门禁。详见下方命令。
- **P0-2 PARTIAL**：[documents.mjs:14](../../src/lib/documents.mjs#L14) 行锚定防借值；`validate --path docs/defensive-patterns/empty.md` exit 1 并报 `requires non-empty **Prevents:**`，原绕过已修。但报告 `:4`，实际规则 `## Rule` 在原文件第 12 行（frontmatter 偏移丢失）；定位契约未完全修复。各标签负例见 [documents.test.mjs:16](../../tests/unit/documents.test.mjs#L16)。
- **P1-1 PARTIAL**：[search.mjs:20–21](../../src/lib/search.mjs#L20-L21) JSON 截断变 incomplete，独立 `search knowledge --limit 0 --json` 得 `coverage=incomplete,truncated=true,results=[]`；但非 JSON 同一命令仍输出 `No matching knowledge found`，实为至少一个命中被 limit=0 隐藏。建议区分无匹配与未展示；现有 [search.test.mjs:6](../../tests/unit/search.test.mjs#L6) 只覆盖函数结果，无 CLI 文本断言。
- **P1-2 PARTIAL**：[publish.mjs:33–40](../../src/lib/publish.mjs#L33-L40) 写后 read/hash 已纳入 unknown。故障注入测试确断言目标已写、日志 ENOENT、unknown 文案与后续不覆盖，但重试前人工另改目标；同字节更新可重放，见新增 P1-B。
- **P1-3 FIXED**：[kno.mjs:41](../../scripts/kno.mjs#L41) 检查 draft；[publish-gate.test.mjs:24](../../tests/integration/publish-gate.test.mjs#L24) 覆盖 submitted/reviewed/approved/rejected/published/superseded，真实 CLI exit 1 且比较候选原始字节。
- **P1-4 FIXED**：[kno.mjs:28–32](../../scripts/kno.mjs#L28-L32) 先解析 init；[cli.test.mjs:13](../../tests/integration/cli.test.mjs#L13) 真正从 os.tmpdir 调 CLI，在有效目标写入、无 Git 目标零写入。
- **P1-5 FIXED**：[publish-gate.test.mjs:25](../../tests/integration/publish-gate.test.mjs#L25) 真实 CLI review/approve 后重新从磁盘加载，确认已持久化；revise 后再次加载验证 revision +1、reviews 空、approval null、旧 publish exit 1。读盘解析器复用实现，但记录确实由子进程写入，非原测试的内存空记录。
- **P1-6 NOT FIXED**：[README.md:100](../../README.md#L100) 仍链接 `docs/test-report.md`；复审时该文件不存在，§8 五级证据及编号声明仍无该报告可核查。
- **观测漂移失效 PARTIAL**：独立在 approved 后改目标，`publish` exit 1 输出 `previous review/approval invalidated by observed drift`；恢复原字节后再 `publish` exit 1 `candidate status must be approved`，`candidate show` 显示 submitted、reviews=[]、approval=null、invalidations 非空。但后期重读发现的漂移仍可复活（新增 P1-A）。

## 新增 findings
- **P1-A 代码 bug：最后重读观测的漂移未持久失效。** [publish.mjs:30–32](../../src/lib/publish.mjs#L30-L32) 检出不一致直接 throw，未调用失效持久化。独立临时 Git 仓库正常 approve C-0003；注入 `readFileImpl` 于第二次目标读取前实际写入变化，首次返回 `target changed since candidate creation; re-review required`；恢复原目标字节后直接再次调用 `publish` 返回 `{"published":true,...}`。这不是检查后的未观测 TOCTOU：第二次读取确已观察漂移。建议所有观测点统一持久失效，覆盖检查与恢复间交错，并测试 candidate 文件持久状态。
- **P1-B 代码 bug + 测试缺口：写后 unknown 可盲重放。** 当 update 的候选正文与既有目标完全相同，目标写后校验注入失败返回 `publish result unknown: target written, ledger not updated`；原目标 hash 未变，再次调用 `publish` 实测 `{"published":true,...}`。测试 [publish.test.mjs:22](../../tests/unit/publish.test.mjs#L22) 在重试前改目标，故未覆盖同字节分支；建议写前持久化可恢复的发布意图/未知哨兵或拒绝无变化 update，并在不改目标时断言禁止重试；真实进程崩溃另测。
- **P1-C 测试有效性/定位：** P0-2 复验诊断行是 frontmatter 剥离后的行数，非原文件行数；[documents.mjs:8,14](../../src/lib/documents.mjs#L8-L14) 均基于剥离后文本。保留原行偏移并断言 JSON/文本中的原始行号。

## 独立执行记录
- `npm test` → `tests 53; pass 53; fail 0`，exit 0；其绿灯不覆盖上面的额外故障交错。
- `node scripts/kno.mjs validate --project .` 在本报告创建前 exit 1，原因是现有 postmortem 链接本报告尚不存在；本报告落盘后复跑返回 `0 errors, 0 warnings`、exit 0。
- 实验仓库 `T=/var/folders/4h/9g7lzjcn23d0vd44jf5_mv0r0000gn/T//pko-review2-XHmp0H`，`K=<PKO绝对路径>/scripts/kno.mjs`；`git -C "$T" init -q; node "$K" init --dir "$T" --json` exit 0。配置通过 `node -e 'const fs=require("fs");let p=process.argv[1],c=JSON.parse(fs.readFileSync(p));c.knowledgeRoots.cookbook="custom/recipes";fs.writeFileSync(p,JSON.stringify(c))' "$T/.pko/config.json"` 修改。
- `printf 'this is invalid\n' > "$T/bad.txt"; cp "$T/bad.txt" "$T/custom/recipes/validation.md"; node "$K" validate --project "$T" --path custom/recipes/validation.md` → `missing YAML frontmatter`、exit 1；删除仅本次验证用文件。
- `node "$K" candidate new --project "$T" --kind cookbook --title Bad --author alice --target custom/recipes/bad.md --body "$T/bad.txt"` → C-0001；`node "$K" candidate submit C-0001 --project "$T"` → 格式错误、exit 1；`node "$K" publish C-0001 --project "$T"` → `candidate status must be approved`、exit 1。
- 为单测 publish 门禁，`node --input-type=module -e 'import {loadCandidate,saveCandidate,bindingOf} from "./src/lib/candidates.mjs";let c=await loadCandidate(process.argv[1],"C-0001"),b=bindingOf(c.meta);c.meta.status="approved";c.meta.approval={by:"test",...b};c.meta.reviews=[{reviewer:"bob",verdict:"approve",notes:"injected gate test",...b}];await saveCandidate(c.file,c.meta,c.body)' "$T"`；再次 `node "$K" publish C-0001 --project "$T"` → `missing YAML frontmatter`、exit 1，`test ! -e "$T/custom/recipes/bad.md"` exit 0。
- DP 反例为合法元数据 + `# Example defensive patterns` + `## Rule` + 空 `**Prevents:**`、后两标签有值；`node "$K" validate --project "$T" --path docs/defensive-patterns/empty.md` → 1 error、exit 1，错误行号如 P0-2 所述。
- 更新漂移：C-0002 由 `candidate new`、`submit`、`review --reviewer bob --verdict approve --notes checked`、`approve --by human --confirm` 依次执行均 exit 0；`printf 'changed bytes\n' > "$T/custom/recipes/drift.md"; node "$K" publish C-0002 --project "$T"` → invalidated、exit 1；`cp "$T/original.txt" "$T/custom/recipes/drift.md"; node "$K" publish C-0002 --project "$T"` → status must be approved、exit 1，show 确认清空。
- P1-A 以已审核 C-0003 调 `publish(root,"C-0003",{readFileImpl})`：注入函数在目标第二次读取前 `writeFile(target,"intervening drift\n")`，第一次拒绝；`writeFile(target,"baseline\n")` 后 `publish(root,"C-0003")` 成功。P1-B 单独临时仓库 `T=/var/folders/4h/9g7lzjcn23d0vd44jf5_mv0r0000gn/T//pko-replay-svtXwz`：同文件为目标和 body，正常审核授权；注入第三次 read 抛异常后无更改重试成功。两次实验均使用真实 Git/CLI 创建候选，注入仅在发布模块测试接口。
- 两个临时路径均在清理前记录并核对前缀后删除；未安装依赖、未 commit、未修改被审代码。

## §9 更新
1. **未验证**：53/53，本仓 validate 0 errors；仓库未提交，不是 clean checkout。
2. **PASS（既有真实 CLI 测试）**：init 两次；其不变性以 Git porcelain 而非全文件字节证明。
3. **PASS（既有测试）**：冲突退出、AGENTS/index 字节保留；安全项可创建。
4. **FAIL**：标准路径及原绕过已修，但 P1-A/B 下漂移失效及 unknown 后禁止重放不完整。
5. **PARTIAL**：所列负例有测试；DP 诊断行错误，见 P1-C。
6. **未验证**：部分替代旧 note 的演化验收仍缺可追溯场景，不因相似启发式测试通过而通过。
7. **PASS（既有真实 CLI 测试）**：复制工具不同 cwd、无 package.json/CommonJS；其他平台不推断。

**测试独立性与限制：** 新增测试有真实 Git、spawn CLI、临时目录清理；部分构造治理记录复用 `bindingOf`/`saveCandidate`，不等价于完整真实治理流程。故障测试使用注入接口而非真实崩溃。外部身份、DSH Skill 加载、锁/TOCTOU 排他均非本次验证。
