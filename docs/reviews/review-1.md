# AKE v0.1 独立审查 1

**结论：需修复后复审，不予放行。** 审查时间 2026-11-09；被审文件均未提交。P0 指阻断冻结契约验收，不表示安全隔离失效（产品不承诺隔离）。

## §9 逐项验收
1. **未验证**：当前非 clean checkout，无法声称 clean checkout 通过；当前树 `npm test` 42/42 pass，`validate --project .` 0 errors/0 warnings。
2. **PASS（现有测试证据）**：真实 git/CLI init、二次 identical/skip，另有独立首次 init；现有测试用 Git porcelain 而非完整字节快照证明不变。
3. **PASS（现有测试证据，范围有限）**：预置 AGENTS/index 时冲突退出 1 且二者字节不变；安全缺失项仍可创建，符合 §7 混合计划。未独立测试各类不可读/竞争状态。
4. **FAIL**：独立完整正常链路、修订、自审、正文/目标漂移拒绝已执行；自定义根非法正文可提交发布（P0-1），不能满足完整门禁。其他拒绝矩阵仅部分有单元/集成证据。
5. **FAIL**：标签非空检查可被空值绕过（P0-2）；缺 metadata、note 不一致、缺章节、悬空链接、重复 id、坏 marker 有测试，但不能由测试通过推导所有格式门禁正确。
6. **未验证**：未见部分替代旧 note 并指定更新目标的真实演化场景断言；相似度仅标题词启发式，是否满足该验收需场景验证。
7. **PASS（测试+独立证据）**：复制工具、无 package.json 和 CommonJS、目标内子目录与外部 cwd 指定 `--project` 均有测试；独立从 `/tmp` 指定项目运行 search/validate。未验证其他平台。

## Findings

### P0-1｜代码 bug：配置根绕过格式门禁
- [documents.mjs:10–15](../../src/lib/documents.mjs#L10-L15)、[scripts/ake.mjs:40](../../scripts/ake.mjs#L40)、[publish.mjs:21](../../src/lib/publish.mjs#L21)：类型靠硬编码默认目录推断，非默认根得到 null 后返回零错误；submit、publish 和 validate 都误认无效正文合格。
- 独立真实仓库将 `knowledgeRoots.cookbook` 设为 `custom/recipes`，`printf 'this is invalid\n' > "$T/bad.txt"`；执行下方 C-0003 全链路后 `published custom/recipes/bad.md; ledger updated`、exit 0，`$K validate --project "$T"` 返回 `0 errors, 0 warnings`。
- 修复：按配置 roots 识别 kind 并显式传入文档校验器；未知/重叠根须 fail-closed；覆盖四类自定义根、候选、validate、搜索类型及反例。

### P0-2｜代码 bug：防御规则空标签可通过
- [documents.mjs:14](../../src/lib/documents.mjs#L14)：`\\s*\\S` 跨行匹配，空 `**Prevents:**` 会把下一行 `**Reviewer check:**` 当作值，违反 §4.3 每标签非空。
- 命令：`node --input-type=module -e 'import {validateDocument} from "./src/lib/documents.mjs"; const t=`...`; console.log(JSON.stringify(validateDocument(t,"docs/defensive-patterns/a.md")))'`；其中合法 frontmatter 后为 `# Example defensive patterns\n\n## Rule\n**Prevents:**\n**Reviewer check:** yes\n**Boundary:** yes\n`；实际 `[]`，exit 0。
- 修复：按行检查各标签同一行真实值，补三个标签各自为空及下一行标签的反例，并覆盖 CLI submit/publish。

### P1-1｜代码 bug + 测试反向固化：截断仍显示覆盖完整
- [search.mjs:20–21](../../src/lib/search.mjs#L20-L21)、[search.test.mjs:6](../../tests/unit/search.test.mjs#L6)：`node scripts/ake.mjs search knowledge --limit 0 --json` 返回 `coverage=complete, truncated=true, results=0`；理由为 `results truncated to 0 of 8`。违反 §5；测试明确断言错误的 complete。无结果文本还可能误导为未命中。
- 修复：结果截断令 coverage incomplete；区分零展示与零命中，修改现有断言并覆盖有命中但被截断的 CLI 输出。

### P1-2｜代码 bug：目标已写后校验失败未报告 unknown
- [publish.mjs:31–38](../../src/lib/publish.mjs#L31-L38)：目标 rename 后的 readFile 或 hash mismatch 在 `try` 外；失败时报普通读取/hash 错误而非 §6 要求的 `publish result unknown`，目标可能已更新而账本未更新。
- 证据：控制流静态检查；现有 [publish.test.mjs:20](../../tests/unit/publish.test.mjs#L20) 只制造 append 失败，未覆盖写后 reread 失败/hash mismatch 或进程中止。
- 修复：将写后读取和 hash 确认失败归入未知结果分支，人工对账；注入相应故障并断言目标和账本状态。真实崩溃恢复仍需独立验证。

### P1-3｜代码 bug：状态机缺合法跃迁检查
- [scripts/ake.mjs:40](../../scripts/ake.mjs#L40)：submit 不检查旧 status 或清除旧 review/approval；可从 reviewed、approved、rejected、published 再 submit 而不 revise，违背状态/终态语义。静态证据：该分支直接把 `c.meta.status='submitted'`；现有集成测试无终态重放断言。
- 修复：规定只允许 draft→submitted，拒绝终态或越级重放；验证失败不写候选、不恢复旧绑定。

### P1-4｜代码 bug：外部 cwd 指定 init 目标仍要求 cwd 是 Git
- [scripts/ake.mjs:31–32](../../scripts/ake.mjs#L31-L32)：`cd /tmp && node /Users/shakya/dev/agent-knowledge-engine/scripts/ake.mjs init --dir /Users/shakya/dev/agent-knowledge-engine --dry-run` 返回 `not a AKE project: no .git repository found`，exit 1；目标本身是有效 Git，违背 init 指定目标语义。
- 修复：init 先以 `--dir` 解析验证目标，其他命令再按 `--project`/cwd 解析；补外部 cwd 的真实 CLI 测试。

### P1-5｜测试缺口：修订失效断言未真正放入旧记录
- [candidates.test.mjs:7](../../tests/unit/candidates.test.mjs#L7) 把 reviews/approval 写入内存对象后没有保存，只把磁盘 draft 改为 submitted；revise 清空断言即使实现不清除真正旧记录也会通过。
- 修复：通过真实 CLI 审核和确认批准，读取持久记录后 revise，断言 revision 增加、旧记录清除、旧批准无法发布；覆盖正文及四元绑定各分量。

### P1-6｜文档缺失/不诚实风险：缺报告却声称可引用
- [README.md:100](../../README.md#L100) 链接 `docs/test-report.md` 并称真实会话作为个别观察记录；审查时该文件不存在（读取报 not found），§8 强制的五级证据及 P-PROMPT/P-CHECK/P-UNVERIFIED 编号无法核查。
- 修复：提供真实可追溯报告，未执行的真实 Single-Session/Teams 明列未验证，修正文案；不要把 prompt 或虚构身份当实测证明。

### P2｜待验证风险与简化建议
- [candidates.mjs:34–45](../../src/lib/candidates.mjs#L34-L45)：相似扫描对 `readdir` 所有错误均当空目录；[publish.mjs:9,24](../../src/lib/publish.mjs#L9-L24) 自己再扫一遍且忽略 symlink。权限错误、配置根逃逸/重叠、跳过文件对冲突覆盖的影响需独立故障注入；建议复用一个受控遍历器并对不完整覆盖 fail-closed。
- [documents.mjs:7–8](../../src/lib/documents.mjs#L7-L8) 仅处理三反引号围栏，波浪线/未闭合围栏及围栏移除后的行号准确性未验证；补 Markdown 反例，不必引入完整 Markdown 框架。
- TOCTOU 最后检查后仍可外部写，不是声称的锁；linked worktree、并发交错、实际崩溃、平台/Node 版本、不可读目标未独立验证。测试 CJK 存在，但 custom root 测试仅验证路径而非文档 type/gate。
- 未见需要新增架构抽象；相反重复遍历可收敛。`--reviewer`/`--by` 可伪造及普通工具绕过为明确非安全边界，不算漏洞。

## 实测记录（命令和关键输出）
环境 Node `v26.13.0`；`npm test`：`tests 42; pass 42; fail 0`；`node scripts/ake.mjs validate --project .`：`0 errors, 0 warnings`；`node scripts/ake.mjs status`：`9 knowledge documents; 5 type/status groups; 0 pending candidates; verified unknown=6, pending=3`；均 exit 0。

独立实验变量：`T=/var/folders/4h/9g7lzjcn23d0vd44jf5_mv0r0000gn/T//ake-review-6rG7Zw`；`K="$T/.ake/tools/scripts/ake.mjs"`；`P=.agents/notes/proposed/process/2026-11-09-review-example.md`。用 `git -C "$T" init -q` 创建真实仓库；`node "$PWD/scripts/ake.mjs" init --dir "$T" --json` exit 0。正文 `$T/body.txt` 是合法 proposed note，含 Problem/Proposal/Alternatives considered/Acceptance criteria/Risks。

- `node "$K" candidate new --project "$T" --kind note --title 'Review example' --author alice --target "$P" --body "$T/body.txt"` → `candidate C-0001 created (draft)`；`node "$K" candidate submit C-0001 --project "$T"` → submitted；均 exit 0。
- `node "$K" review C-0001 --project "$T" --reviewer alice --verdict approve --notes checked` → `a candidate author cannot review its own candidate`，exit 1。
- `node "$K" review C-0001 --project "$T" --reviewer bob --verdict approve --notes checked` → reviewed；`node "$K" approve C-0001 --project "$T" --by arbitrary-nonhuman-string --confirm` → approved；均 exit 0，身份只是字符串声明。
- `printf '\nChanged.\n' >> "$T/.ake/candidates/C-0001-review-example.md"; node "$K" publish C-0001 --project "$T"` → `contentHash mismatch; re-submit and re-review`，exit 1。
- `node "$K" candidate revise C-0001 --project "$T" --body "$T/body.txt"` → revision 2 draft；重新执行上述 submit、bob review、approve 后 `node "$K" publish C-0001 --project "$T"` → `published ...; ledger updated`，exit 0。
- `cd /tmp; node "$K" search 'Review example' --project "$T" --json` → query terms `review`, `example`；`node "$K" validate --project "$T"` → `0 errors, 0 warnings`，exit 0。search 输出截取未独立核对命中内容；现有 e2e 测试断言实际路径。
- `node "$K" candidate new --project "$T" --kind note --title 'Update example' --author alice --target "$P" --body "$T/body.txt"` → C-0002；依次 submit、bob review、arbitrary-nonhuman-string approve 均 exit 0。`printf '\nDirect bypass write.\n' >> "$T/$P"` 直接写正式文件成功（P-PROMPT-2 边界事实）；`node "$K" publish C-0002 --project "$T"` → `target changed since candidate creation; re-review required`，exit 1。
- 自定义根：`node -e 'const fs=require("fs");let p=process.argv[1];let c=JSON.parse(fs.readFileSync(p));c.knowledgeRoots.cookbook="custom/recipes";fs.writeFileSync(p,JSON.stringify(c));' "$T/.ake/config.json"`；`printf 'this is invalid\n' > "$T/bad.txt"`；`node "$K" candidate new --project "$T" --kind cookbook --title Bad --author alice --target custom/recipes/bad.md --body "$T/bad.txt"` → C-0003；submit、bob review、`approve C-0003 --project "$T" --by fake --confirm`、publish 全 exit 0；详见 P0-1。
- 临时路径已在清理前记录，`rm -rf -- "$T"` 仅在验证其为本次 `ake-review-*` 临时目录后执行；未更改被审实现、未安装依赖、未提交 Git。

## 边界与 Lead 裁决
- **P-PROMPT-1/2**：Skill 和模板确有软性要求；直接写入证明不构成强制控制。**P-CHECK-1/2**：自审、正文/目标漂移拒绝有实测，但 P0 显示不能笼统宣称所有格式门禁合格。**P-UNVERIFIED-1–4**：真实身份、Skill 实际加载、真实任务效果、平台及崩溃恢复未验证。
- 请 Lead 裁决：① §9-6 的部分替代场景所需最小可观察契约；② P1-2 未知结果与人工对账机制的恢复范围；③ 补齐真实 DSH 运行证据是否为本次放行前置条件（不可将未验证标通过）。
