# PKO v0.1 设计复审与验收契约

> **与现有冻结接口的关系：本评审是变更提案，不擅自改写 [architecture.md](architecture.md)。** 以下与该接口不一致之处须 Lead 裁决后再实施：首行 Agent Note 与必填 frontmatter 的矛盾；人读正文/路径权威及索引冲突规则；hash 原始字节与 normalized body；审核和授权同时绑定目标/操作；缺失知识目录的覆盖语义；init 的状态命名、默认 AGENTS 处理与片段输出；禁止对所有并发都宣称可检测。本文对 absent AGENTS 采取更保守的“不创建”提案，用户只明确禁止静默改写，Lead 可决定是否允许按现有契约创建；缺失目录按本评审视为已确认空目录，亦可按冻结接口保守报告 incomplete。若未获批准，执行者不得把这些差异当作已变更的接口。另需修复冻结接口内部关于 Note 首行/frontmatter、postmortem status 枚举的矛盾。
>
> 性质：实施契约与待执行测试，不是实现或验证报告。固定路线为目标项目内 Markdown/Git、AGENTS.md、Skill 和无依赖 Node CLI；状态与记录放在 `.pko/`。以下“必须”是 MVP 验收目标，不是既有能力声明。
>
> 证据：首选 [研究报告 v2](../research/knowledge-ops/REPORT-knowledge-ops-v2.0.md)、[检索研究](../research/knowledge-ops/findings/01-knowledge-retrieval.md)、[团队研究](../research/knowledge-ops/findings/02-team-presets.md)、[发布研究](../research/knowledge-ops/findings/03-review-publishing.md)；四类格式参考 [Agent Notes](../research/knowledge-ops/official/.agents_notes_README.md)、[Defensive patterns](../research/knowledge-ops/official/docs_defensive-patterns_README.md)、[Post-mortems](../research/knowledge-ops/official/docs_postmortem_README.md) 与 [cookbook 样例](../research/knowledge-ops/official/sample-cookbook.md)。抓取的 cookbook README 为 404，不是格式证据；样例更像参考手册，并未证明官方 cookbook 均为步骤型，步骤型是本 MVP 要求。报告中的“当前工作区非 Git 仓库”属于原调研环境，不适用于本项目；本次 `git rev-parse --show-toplevel` 返回当前项目根。

## 1. 候选与发布状态机

### 必须满足

- 治理状态独立于正式文档语义：`draft → submitted → reviewed → approved → published`；`rejected` 可从 submitted/reviewed/approved 进入，`superseded` 可从 draft/submitted/reviewed/approved/rejected 进入，均为该修订终态；published 不反向改写，后续变更新建候选。拒绝及替代需记录原因；替代还记录后继候选 ID。需修改时创建新 revision 的 draft，保留旧记录，不直接把已审核 revision 改成另一个内容。审核不通过不进入 reviewed，可拒绝或另建 draft。
- 候选 revision 至少固定候选 ID、revision、类型、项目内相对目标路径、操作（新建或更新）、作者声明、正文及目标快照。`contentHash` 明确定义为将**拟发布的完整 Markdown 文件原始字节**做 SHA-256，包含任何 frontmatter、换行及最终换行；不做换行或 Unicode 规范化，记录算法。避免把治理元数据混入被 hash 正文。目标已有文件时 `targetHash` 为其原始字节 SHA-256；新建用独立的 `absent` 哨兵，绝不能用空文件 hash 表示不存在。
- submit 固定内容、类型、目标、操作和 targetHash；review 记录 reviewer 声明、结论、证据、时间及整个绑定集（至少 contentHash、目标路径、操作和 targetHash）；approval 记录批准者声明、明确授权范围/操作、时间及同一绑定集。审核者与作者声明相同、独立性不明或缺乏实质复核证据时，不通过；身份和独立性仍只能声明，见第 5 节。授权应人工明确给出，不能把模型自报或审核通过自动视为授权。
- 内容、目标路径、操作或目标实际字节变化，先前 review **和** approval 都失效，停止并重新提交、审核、授权；恢复原字节也不能悄悄复活已失效记录。发布前重读并校验绑定集、状态及目标，使用确定的错误原因停止，不自动覆盖或重试。对新建目标出现、更新目标消失也算变化。只改治理元数据不得悄悄改变目标或重用不相容记录。
- fail-closed 清单：状态/跃迁非法或终态重放；必填信息、记录或授权缺失/损坏/歧义；无通过审核或作者自审/独立性不可确认；审批缺失或范围不匹配；内容/目标 hash、类型、路径、操作任一不匹配；目标无法读取、未能确认缺失、路径越界或符号链接导致不安全；四类结构校验失败；重复/冲突检查所需覆盖不完整或发现未处理冲突；目标存在不属于本次授权的用户变更；写入、状态持久化或结果确认失败；检测到并发冲突或先前发布结果未知。拒绝输出原因，不把未知当成功。
- 仅处理单个正式 Markdown 目标；发布前后须记录可用于人工核对的候选 ID、revision、绑定集及结果。进程崩溃导致目标已写而账本未更新时标记/报告结果未知，禁止盲目重放或自动覆盖，人工核对实际文件后经明确处置恢复；不得宣称多文件原子或 exactly-once。仅保证 CLI 可检测的变化，不宣称能阻止检查后外部写入（TOCTOU）。

### 明确不做

不提供强制身份认证、真实人工身份核验、不可绕过的权限隔离、自动授权、全局事务、强制锁、未经授权的归档/删除或 Git commit；也不宣称文件 hash 证明内容正确、审查独立或没有重复。语义相似冲突由审核人判定，文件名相同/不同均非去重结论。

### 验收测试点

1. 全链路成功和所有越级、终态重复、缺审核/授权均检查状态、返回结果及正式文件无意外变更。
2. 分别在审核后改候选一字节、改目标一字节、换路径/操作、将不存在目标创建为空文件、删除原目标；旧审核及授权全部失效，发布拒绝且保留外部内容；恢复旧字节亦不能复活失效记录。
3. 同一声明作者自审、缺证据、批准绑定另一 revision、损坏记录、不可读目标、路径穿越/符号链接逃逸、检索覆盖不全与冲突未决都拒绝，报告具体原因。
4. 注入目标写成功但账本写失败/进程中止；下一次输出未知并不盲目重试；检查目标与账本可人工对账。模拟检查后的外部写竞争，报告检测边界，不把不能证明排他视为通过。

## 2. 四类知识最小可校验契约

### 必须满足

- 人读权威是正式 Markdown 正文与其目录承载的类型/生命周期；`.pko/` 中候选状态、审核及授权记录是治理权威，不能覆盖正式正文语义。机器索引可派生 path、type、title、documentStatus、scope、更新时间等，缺失用 `unknown`，不得编造；索引与正式正文/路径冲突时以正文及路径为准，重新生成索引，并把无法消解的正文与路径冲突报告为校验错误。`published` 是治理状态，绝不替代文档状态。
- 四类均须有非空 H1、非空正文，并按目标目录识别类型；显式空白章节不算合格。范围可从人读内容提取；缺失时报告 `unknown`，不为满足索引虚构范围。可选最小 frontmatter 只做机器辅助，不能覆写人读事实或破坏 Agent Note 首三行的官方格式；推荐元数据存 `.pko/`，无需要求所有文档增加 frontmatter。对于其他三类若确用 frontmatter，须规定键及冲突检查，未实现的自由 YAML 解析不属于 MVP。
- **Agent Note**：首三行严格为 `# Agent Note: <非空标题>`、空行、`Status: <值>`，接空行。目录 `.agents/notes/{proposed,implemented,rejected}/<class>/<yyyy-mm-dd>-<topic>.md`；class 用官方六值 feature、bug-fix、simplification、architecture、process、testing，日期需合法。Status 分别为 `proposed`、`implemented`、`rejected — <非空理由>` 且与目录一致。`## Problem` 是正文第一个二级章节；均需非空 `## Alternatives considered`；proposed 另需非空 `## Proposal`、`## Acceptance criteria`、`## Risks`；implemented 另需非空 `## Decision`、`## Consequences`，拒绝 Proposal/Plan/Migration plan/Acceptance criteria 章节；rejected 需非空 `## Proposal`，保留原提案内容。分类/日期仅供结构检查，不自动证明历史或已交付事实。
- **Defensive pattern**：每条规则以独立二级章节承载；每条必须有非空规则陈述、预防缺陷、reviewer 判定条件、边界及例外审批、正确例与错误例。MVP 可规定对应明确子标题以便逐条校验，允许一个文件多条规则；机器仅能检查结构和非空，不能判断范例正确或边界合理。此为本 MVP 的可机检约束，官方样例不保证每条均显式分节，导入既有样例可能需人工整理，不能宣称完全兼容官方现存文件。
- **Postmortem**：非空 `# Post-mortem NNNN: <标题>`，NNNN 为四位数字，非空 `Status:` 行（不强加 note 的枚举）；非空二级 `Executive summary`、`Summary`、`Impact`、`Timeline`，以及以 `Root cause` 开头和以 `Guardrails` 开头的非空二级章节，允许编号/描述性后缀以兼容官方样例。Status 的具体含义由正文解释，不推断事故已经解决。
- **Cookbook**：非空 H1、适用范围或前提、至少一个有序的可执行步骤（编号列表或有序步骤小节）及预期结果/验证方式；这些标题为 MVP 约定而非已证实官方统一 schema。机器只检验结构，不证明步骤可执行。范围与状态缺失返回 unknown，不强加 proposed/implemented/rejected。
- 章节识别须避免把代码围栏内部伪标题计为章节；输出字段名、文件路径和可定位的错误。有效结构不等于事实真实、证据充分或安全可用；敏感信息由人审，不能宣称静态字段校验保证脱敏。

### 明确不做

不对非 Agent Note 强制 Agent Note 生命周期、分类或头部；不把候选状态写进正式文档 `Status:`；不要求全面复制官方双语 triplet、归档系统、集中 INDEX、完整 Markdown/YAML 引擎，也不自动修复语义冲突。历史 archived 若存在应作为历史线索，不纳入当前规则权威；MVP 不实现归档迁移。

### 验收测试点

1. 三种 note 合法样本均通过；状态与路径冲突、非法日期/class、漏章节、围栏中伪章节、空章节及 implemented 的 proposal 类章节均失败并指出位置。
2. 单文件含两条 defensive rule，其中一条缺错误例或例外审批，应针对该条失败；正常 cookbook/postmortem 即使没有 note 状态也可通过；样例 postmortem 的带编号 Root cause 与 Guardrails added 能通过。
3. 相同信息在索引及正文不一致时正文胜出并提示索引过期；note 路径与 Status 不一致时不可自动选一个发布。缺范围显示 unknown；结构合格但虚假内容的测试不能声称语义验证成功。

## 3. 检索最低可用判据

### 必须满足

- CLI 明确扫描四类知识目录，包括隐藏 `.agents/notes`；检索关键词、实际扫描范围、未覆盖目录与原因均可见。输出稳定结构：每项含项目相对 `path`、`type`、`status`（文档状态；无则 unknown）、`scope`（文本或 unknown）、带行号的 `snippet`、`relevance`（确定性关键词匹配排序依据/分数及其含义）；另有查询词、`coverage`（complete/incomplete）、原因及截断标志。候选不混称正式成果；若检索候选，须明确来源及治理状态。
- 关键词匹配与排序规则须可解释且确定，至少说明大小写处理、多词逻辑和同分排序；片段来自原文且可定位，不能把评分当正确性或语义相关性的概率。使用者仍须读原文并核对上下文。
- 已完成声明范围且无命中时返回“在所述范围**未发现**匹配”，不说“不存在”；遍历或读取失败、忽略/跳过无法判断的文件、结果或片段截断均标 `coverage: incomplete` 与范围/原因；即使有命中也必须告知不完整。不存在的可选知识目录可明确报告不存在并视作已检查空目录，不可将权限错误当不存在。
- 适用性显示已记录的范围、版本/条件与证据，缺失为 unknown；历史、过期或已替代文档显示其人读声明及依据，无法判断为 unknown。检索不自动判定适用或以文件年龄判过期，不设未经验证硬阈值。

### 明确不做

不承诺语义检索、全召回、事实正确、自动判重或自动适用；不因分数低隐藏安全规则，也不把零命中等价于知识不存在。排序成本和召回率须另行测量。

### 验收测试点

1. 四类目录各置匹配项（含隐藏目录），核对字段、片段行号和稳定排序；缺状态/范围为 unknown。
2. 已扫描无命中返回“未发现”；模拟读失败、跳过和结果/片段截断，即使存在命中也标 incomplete、标识漏项原因，不能说“无知识”。
3. 缺目录与权限失败可区分；过期/替代标记可追溯来源，未标注不能仅依文件年龄断言过期。

## 4. init 保守语义

### 必须满足

- 从指定目标或 cwd 向上找到**最近包含 `.git` 文件或目录**的祖先作为 projectRoot，并以 Git 自身检查确认其为有效工作树（含 worktree 的 `.git` 文件）；裸仓库、伪造/损坏 `.git` 或无法运行 Git 均拒绝且无写入，不自动 `git init`。嵌套仓库以最近者为准；路径规范化后不得向目标根外写入，拒绝不安全符号链接路径。
- 创建项目内 `.pko/tools` 可独立运行的 CLI 及其必要模块，以及 `<projectRoot>/.agents/skills/knowledge-ops/SKILL.md`；该路径符合研究资料所述 DSH filesystem provider 的项目 skill 根和直属 `name/SKILL.md` 形状，skill 的 frontmatter 包含有效 name、description。实际发现依赖对应 provider、配置、同名遮蔽与刷新，不能仅凭路径宣称已加载。
- 逐项先计划再应用：目标不存在且安全时创建；已有内容字节相同为 `identical`，无修改；明确不处理/不需要处理为 `skip`，列出原因；已有不同内容、类型不符、不可读或不安全为 `conflict`，原样保留并报告。不得将不同内容悄悄标成 skip 或覆盖。重复运行不修改任何已创建文件；混合冲突可创建互不依赖且安全的缺失项，但总体返回有冲突并逐项报告，不能声称完全成功。
- `AGENTS.md` 默认绝不修改：报告已存在/不存在并输出建议片段（输出到终端或结果，不需额外创建文件）。只有显式 flag 才可追加带唯一 begin/end 标记的片段；若文件不存在，仍只报告/提供片段，不自行创建 AGENTS.md；已存在一份完全相同的完整标记块则 identical，未标记同文、标记不配对/重复、已有标记块不同或文件不可安全读取为 conflict；追加保留原有全部字节，重复运行不重复追加。显式 flag 不授权改写既有标记块。
- 复制后的工具不得依赖源仓库绝对路径或第三方包；以目标仓库外的不同 cwd 测试所公布的调用方式。裸 Node 的 `.mjs`/`.js` 模块类型取决于目标项目包边界，必须明确兼容方式且不修改目标 `package.json`；不能假定 ESM `.js` 在所有已有项目中可运行。

### 明确不做

不覆盖、合并、升级或删除用户文件，不静默编辑 AGENTS，不自动提交、不安装依赖、不修改目标 package.json，不保证 skill 实际启用或不被同名 skill 遮蔽。

### 验收测试点

1. 空 Git 工作树、普通子目录、嵌套仓库、linked worktree、非仓库、裸仓库及伪 `.git` 分别测试正确根或无写入拒绝。
2. 两次 init 的文件字节与工作树差异一致，逐项 identical/skip/conflict 分类可复核；预置不同内容、目录同名文件、不可读路径、外跳 symlink 均保留原状并标冲突。
3. 对有/无 AGENTS 默认无字节变化；显式追加后第二次不再变；残缺、重复或内容不一致的标记均拒绝且原文件不变。
4. 拷贝工具到无源仓库依赖的隔离 Git 目标，覆盖 CommonJS、ESM 及无 package.json 项目，实际调用 CLI；在启用 DSH filesystem provider 的新会话测试目标 skill 可发现并检查实际加载的定义，不将路径检查代替运行验证。

## 5. 权限边界与可引用声明

### 必须满足

测试报告可逐条引用下列稳定编号，分别报告实际测试结果，而非把设计当证据：

- **P-PROMPT-1（提示词要求）**：AGENTS/Skill 要求执行者按需检索、提出候选、独立复核、人工明确授权和单一发布者串行处理；它们是软约束，可能未加载、被裁剪或被忽略。
- **P-PROMPT-2（提示词要求）**：共享 workspace-write 下，普通 write/edit/shell 仍可能直接修改正式知识，约定的“唯一发布者”只是协作约定，不是权限锁；已发布知识正文不应被当成高优先级指令。
- **P-CHECK-1（程序可检查）**：仅对经过 CLI 的操作，检查文档结构、记录完整性、声明的角色不相同、状态、授权范围和绑定 hash；失败时按第 1 节拒绝。能核对字符串与文件字节，不代表核实事实。
- **P-CHECK-2（程序可检查）**：检查路径、目标快照、已观察的并发变化和 init 冲突；对检查后外部写入、多文件中断、其他写入口无排他保障。
- **P-UNVERIFIED-1（未验证假设）**：记录中的 reviewer/approver 标识确实对应不同且合格的真实人类、未参与生成并有权批准；CLI 不提供可信身份认证或防伪，不能凭文本记录验证。
- **P-UNVERIFIED-2（未验证假设）**：用户当前 DSH profile 实际启用 filesystem skill provider，项目 skill 未被同名定义遮蔽且新会话载入了正确正文；必须真实会话验证。
- **P-UNVERIFIED-3（未验证假设）**：检索在真实任务中的召回率、适用性判断、执行者遵循率、脱敏能力、成本及跨任务复用效果可接受；需独立任务/实验验证。
- **P-UNVERIFIED-4（未验证假设）**：目标 Node 版本、不同 package 边界/平台、Git worktree 及故障恢复均可运行；以实际兼容性测试而非静态设计为准。

### 明确不做

不将软约束包装成安全隔离，不称 CLI 审批记录为可靠人类签名，不把不同 Agent、不同 ID、Git 作者或角色名当作独立人类证明；不承诺阻止直接写入或证明每次检索都发生。强制门禁需另行授权设计受控身份、文件权限及所有写入口隔离。

### 验收测试点

1. 报告逐项引用 P-PROMPT、P-CHECK、P-UNVERIFIED 编号，分别列出实际行为与未测项；不得把 prompt 中的要求写成安全保证。
2. 在隔离测试仓库演示共享可写权限下绕过 CLI 直接修改正式文件；若权限策略使该操作不可用，报告其实际原因，不据此宣称一般环境隔离。
3. 伪造不同 reviewer/approver 字符串仍可构造形式记录：测试须明确这是身份验证缺口，而不是通过的独立性安全测试；真实审核与授权证据人工核验。

## 最可能实现错误（按风险排序）

1. **把协作当强制安全**：反例：CLI 拒绝无批准发布，但作者用 shell 直接覆盖 `docs/defensive-patterns/` 文件；CLI 门禁并未约束该入口。
2. **复用过期审查**：反例：审批后目标原文件从 A 改为 B，程序只验 contentHash 就覆盖 B；目标 hash、路径及授权范围也必须绑定并重审。
3. **跨文件半发布当成功**：反例：正文写入成功、账本更新失败后重试覆盖另一个人修改，或无证据直接标 published；应报告未知并人工对账。
4. **把检索不全当不存在**：反例：隐藏 notes 未扫描或权限报错后打印“无相关知识”；必须报告未覆盖和“未发现”语义。
5. **强加 Note 模板或破坏 init**：反例：要求 postmortem 的 `Status: resolved` 改成 implemented；或第二次 init 覆盖用户的 AGENTS.md / 已有 Skill。两者分别违反文档语义与保守初始化。
