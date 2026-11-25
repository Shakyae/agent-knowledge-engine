---
name: ake
description: 在实现、架构、排障、部署、风险变更前检索工程知识；实质工程任务完成且用户确认验证通过后，评估是否按四类知识流程捕获、检查、审核，并等待用户授权后发布。
---

# AKE 使用帮助与入口路由

## A. Skill 日常命令（在对话中使用）

| 命令 | 功能 |
|---|---|
| `/ake` | 显示使用帮助（本页） |
| `/ake help` | 显示使用帮助（与 `/ake` 完全相同） |
| `/ake status` | 查看当前安装和版本状态（只读，不联网） |
| `/ake update` | 检查并更新 AKE（由用户明确发起，走确定性 CLI 流程） |

宿主只把 `/ake` token 交给本 Skill，后面的 `status`、`update`、`help` 是**自然语言**，不是宿主结构化参数路由。遇到歧义、或更新可能覆盖本地定制时，先询问用户，不要替用户决定。

## B. CLI 安装与项目初始化（在终端使用）

| 命令 | 功能 |
|---|---|
| `npx skills add Shakyae/agent-knowledge-engine@<完整commit> --skill ake -g` | 安装/更新到用户级 Skills 目录（Vercel Skills CLI） |
| `ake init` | 初始化当前工作目录 |
| `ake init --dir <project>` | 初始化指定目录 |
| `ake status` | 查看安装状态，同时保留原有知识统计 |
| `ake update` | 检查并更新已安装的 Skill（参数以 `ake --help` 为准） |

说明：`ake` 指 AKE 源码或项目内附带的 CLI（`node scripts/ake.mjs …` 或 `node .ake/tools/scripts/ake.mjs …`）。Skill 的安装与链接由上面的 Vercel Skills CLI 负责；`npx skills update` 不会推进已固定到某个 commit 的安装，因此更新请用 `ake update`。

## C. 知识管理能力

- **自动检索**：任务开始、涉及实现/排障/架构/风险变更时，先检索四类知识（Agent Notes、Defensive Patterns、Postmortems、Cookbooks）。
- **自动评估沉淀**：实质任务完成并经用户确认后，评估本次是否有可复用知识值得沉淀。
- **手动评估当前 Session**：直接要求 AKE 评估这段工作是否值得整理（不要求先跑完自动流程）。
- **手动整理指定经验**：明确指定「把某段经验整理成候选」，AKE 只按你的指定范围整理。
- **查看候选**：`node .ake/tools/scripts/ake.mjs candidate list`（查看全部候选及状态）。
- **检查审核状态**：`node .ake/tools/scripts/ake.mjs candidate show <id>` / `candidate check <id>`。
- **发布授权流程**：候选经独立 reviewer 审核后，需**用户明确授权**才 `approve <id> --by <human> --confirm` 并 `publish <id>`；未授权时保持未发布。

## 路由规则

- `/ake` 或 `/ake help`：**只输出本帮助**。无参数 `/ake` 不解释为知识沉淀任务、不扫描当前 Session、不自动检索、不创建候选。
- `/ake status`：执行 `ake status`（只读）。若当前目录没有 AKE 项目，如实报告错误，不改用其他项目。
- `/ake update`：执行确定性 CLI 更新流程，顺序如下：
  1. 若本 Skill 目录内存在 `resources/ake-source/scripts/ake.mjs` 且支持 `update` → 用它执行；
  2. 否则，若当前处于 AKE 官方源码 checkout（`origin` 为官方仓库、`skills/ake` 无未提交改动）→ 用 `node <checkout>/scripts/ake.mjs update`；
  3. 两者都不满足 → 停止并说明原因，**不得**由模型自行拼 shell、Git、复制或清理命令。
- 更新成功后提示：DSH 每次加载/注入 Skill 时读取磁盘，**本 Session 已注入的旧内容不会自动刷新**；请在新消息中重新调用 `/ake`，若仍使用旧内容则新开 Session。**无需**重启整个 DSH。
- 任何会覆盖用户定制、或无法确认安装目标的情况，先询问用户。

## 示例

1. `/ake` → 只显示本帮助（不检索、不沉淀）。
2. 在项目目录执行 `ake init` → 初始化**当前目录**；换到别处初始化才用 `ake init --dir <project>`。
3. `/ake status` 查看版本/安装/更新状态；需要更新时 `/ake update`（自动备份、校验、失败回滚）。

## 安装、初始化与日常使用的区别

- **安装**：把 Skill 放进用户级 Skills 目录，每台机器/每个用户一次。
- **初始化**：为某个 Git 项目建立 `.ake/`（知识目录、配置、项目内 CLI），每个项目一次。
- **日常使用**：以具体请求调用（例如 `/ake 评估这段经验是否值得沉淀`），或由 AKE 按任务阶段自动检索/沉淀；单独输入 `/ake` 只显示帮助，不触发检索或沉淀。日常使用不重复安装或初始化。

# AKE knowledge operations

先确定目标项目的绝对路径，并使用 Skill 加载器提供的 **本 Skill base directory** 绝对路径；不得从当前工作目录、目标项目或 AKE 源码 checkout 推导 Skill 路径。若加载环境未提供该绝对路径，先请用户提供/确认已安装 Skill 的位置，不要猜路径。

## 项目初始化（按需）

先按目标状态选择入口：若 `.ake/config.json` 与 `.ake/tools/scripts/ake.mjs` 都是普通文件，Agent 直接运行本 Skill 的 `preflight.mjs`；否则先运行 `bootstrap.mjs --dry-run` 预览。不要要求用户代跑预检。Bootstrap 清理 `GIT_*` 环境变量，只在 canonical 目标目录工作，不向上迁移、不创建嵌套仓库；`bootstrap --dry-run` 及普通 bootstrap 均不运行 `git init`。已有父级 worktree、linked worktree、unborn branch（没有首次 commit）都是有效 Git worktree，不要求新建 `.git`。只有 bootstrap 或 preflight 明确返回稳定码 `NOT_GIT_WORKTREE` 时，才可走下面的选项流程：bootstrap 用于尚未初始化/部分状态，preflight 只在现有 AKE 项目 CLI 的 status 明确指出没有仓库时触发。Preflight 的 `GIT_UNAVAILABLE`、`BARE_REPOSITORY`、`STATUS_FAILED`、权限错误、损坏/异常 `.git` 及任何未识别结果都不得当作无 Git，也不得询问 init；只报告并停止相关 AKE 操作。

对稳定码 `NOT_GIT_WORKTREE`（来自 bootstrap 或现有 AKE 项目 preflight），先用本 Skill 的 `init-git.mjs --inspect --dir <绝对目标>` 再检。只读 JSON 返回 canonical `target` 和 `identity`（device/inode/birthtimeNs）；identity 仅用于把执行绑定到询问前看到的目录实例，**不是授权凭据**。只有状态为 `non-repository` 且 identity 可用时，才请求明确选择，并展示 exact canonical 路径。Agent Teams 中只有 Lead 可以向用户发起询问或执行 Git init helper；子 Agent 不得调用用户交互工具、自行询问用户或执行 `init-git.mjs`，应将路径与状态报告给 Lead 并停止该初始化分支。Lead 必须自行重新 inspect 当前 canonical 目标并使用新取得的 identity。Lead 先尝试宿主原生单选（如 `ask_user_question`）；只有宿主没有原生选择能力或该能力技术上不可用（而不是因宿主/系统策略或权限明确拒绝交互）时，Lead 才必须在普通文本消息中展示同一 canonical 路径及选项：“1 — 只在此目标运行 Git init（不 add/commit/push）”；“2 — 暂不初始化”。等待用户针对该路径明确回复 `1` 或 `2`。只有对当前展示路径的明确回复 `1` 才授权继续；回复 `2`、拒绝、空/缺失/含糊答复或任何其他答复均不得运行 helper。拒绝/选 2 时，本任务不再询问 Git 初始化；无明确答复时保持等待，不执行初始化。若当前业务必须用 AKE/Git，说明受限并停止该部分，其他可独立完成的业务继续。若用户选择另一个目标，先取得新路径、对其重新 inspect，并由 Lead 为新 canonical 路径重新展示选择；旧选择绝不授权新路径。非 Team 场景下，原生交互不可用时 Agent 可用同样的普通文本选项询问用户。文本回退中，只有用户针对当前展示路径明确回复 `1` 才构成授权；不得把其他自由文本、工具调用参数、沉默、identity 或 helper 调用当作授权。若宿主不能提供原生单选且 Lead 无法进行文本询问，不运行 helper。若用户交互工具被宿主/系统策略或权限明确拒绝，不得改用文本渠道绕过拒绝；立即停止并报告。

只有用户通过原生选择选中“只在此目标运行 Git init”，或在 Lead 展示文本选项后针对当前显示的 canonical 路径明确回复 `1`，才能调用 `node <本 Skill base directory 的绝对路径>/init-git.mjs --dir <JSON 返回的同一 canonical 路径> --expected-identity <同一 JSON 的 device:inode:birthtimeNs>`。在 Team 场景中，Lead 必须由自己直接调用该 helper，使用其刚才重新 inspect 得到的同一 canonical 路径和 identity；不得将用户答复或 helper 执行转交给子 Agent。子 Agent 不得把未收到的答复视为同意，也不得执行 helper。拒绝、选 `2`、空/缺失/含糊答复或其他非 `1` 答复都不得调用 helper；拒绝/选 `2` 后本任务不再询问，未收到明确答复时等待或报告受限。helper 会先校验该快照，再在 Git 状态检查前后和启动前复核目录身份及仓库状态；若目录被替换/身份不可用/已经变化，不运行 `git init`，不自动重问；需用户主动选择另一个目标并为新身份重新授权。Git `init` 没有跨平台原子“仅首次创建、已存在即失败”操作：此流程要求单写者，不得让其他 Agent、终端或程序并发操作该目标；重检只能缩窄、不能消除外部检查-使用竞态。Git 输出中的 `Reinitialized` 只作停止信号，不能作为成功/安全证据。执行或后验验证非零、信号终止、结果不确定时，保留 `.git` 与模板/配置等盘面，不重试、不清理、不继续 AKE 写入，报告人工检查。`git init` 可能创建 `.git` 内的默认配置、模板文件及其他 Git 初始化产物；不得承诺只写 `.git` 或只有元数据副作用。成功后验证 exact work-tree root 和 unborn HEAD；若 helper 返回 `already-worktree`/`already-parent-worktree`，表示未运行 Git init，直接按当前状态进行对应预检，不重复询问。若原目标已有 AKE config/CLI，重新运行 preflight，绝不 bootstrap 覆盖；否则重新 bootstrap dry-run，任何 `conflict` 都停止，无冲突才 apply。原生流程仅用户选择对应选项构成授权；文本回退仅针对当前 exact canonical 路径的明确回复 `1` 构成授权。其他自由文本、工具参数、identity 快照或 helper 调用本身都不构成人类授权；Skill 仅是软流程约束，不是宿主安全边界。

零项目文件写入的保证仅适用于 bootstrap dry-run 和 bootstrap 在 apply 前拒绝的分支；不适用于 `git init`（Git 可复制模板、生成默认配置等），也不适用于下面会执行既有项目代码的 preflight。

若目标已初始化，不要重复 bootstrap、复制或升级配置/CLI。Bootstrap 的 config/bundle 元数据比较不证明现有 CLI 版本。需要确认项目根时，Agent 在任务真实目录和当前环境中运行一次 status 路径预检：

```bash
node <本 Skill base directory 的绝对路径>/preflight.mjs --dir <绝对目标路径>
```

Helper 只运行既有项目 CLI 的 `status --json`，要求返回绝对 `project` 路径且其 realpath 与目标 realpath 相同；status 成功仅验证项目选择，不证明任何任务命令兼容。相对、缺失、不可解析或不匹配的路径均停止。预检后，Agent 在相同真实 cwd/env 直接执行实际任务所需的命令。若只读操作（例如 `search`）需要任何 CLI options，先在同一真实 cwd/env 只读运行 `node .ake/tools/scripts/ake.mjs --help`，并检查该 CLI 当前 `search` usage 是否精确声明本次每个所需 flag 及值形态（例如 `--status STATUS`、`--budget-bytes N`、`--type TYPE`、`--limit N`、`--json`）。不同版本的 help 文字差异本身不单独判失败；但所需参数缺失、help 失败/不可读/无法解析时，能力即未获证明：不要运行带该选项的 search，不得删掉选项静默降级、猜测替代参数或重搜；明确报告 CLI 未声明/无法确认该选项，不能声称该过滤/预算已生效。Help 是 CLI 的能力声明，不是行为证明或安全保证。支持的只读 search 执行一次，直接使用原始完整结果，包括 query/options、filters、coverage，不重复搜索来验证或重新提取结果；若请求 `--type`/`--status`，还须核对结果 JSON 回显的 filters 与请求完全一致，否则把过滤结果标为未验证，不重跑。`--budget-bytes` 只涉及其明确契约范围，不得称为完整 stdout 硬上限。对写操作不运行破坏性探测；实际命令若返回不支持/参数不兼容等错误，应如实诊断，不得将 status、help 或入口存在宣称为写操作兼容/安全，也不得将其作为授权。

实际操作沿用核验时的真实 cwd/env；仅在 cwd、环境、目标项目配置/CLI 或相关上下文发生变化后重做身份核验，不要求每条写命令前都重复扫描。Preflight 会运行项目已有 CLI，不能保证无副作用或认证 CLI 身份。若 DSH 宿主、系统策略或权限拒绝 helper/子进程，立即停止，不得通过 Node/bash 包装器、MCP 或其他执行路径绕过。Bootstrap 遇到既有配置/CLI只保留现状；若报告项目根不符或部分初始化，先备份并人工审阅迁移/合并方案，禁止自动复制、升级或覆盖项目文件。

若缺任一文件，使用本 Skill 随附的离线资源执行器，不依赖 AKE 源码 checkout 或调用时的工作目录。先展示计划：

```bash
node <本 Skill base directory 的绝对路径>/bootstrap.mjs --dir <绝对目标路径> --dry-run
```

dry-run 若报告任何 `conflict`，停止并报告冲突路径；不要应用部分计划。无冲突后再应用：

```bash
node <本 Skill base directory 的绝对路径>/bootstrap.mjs --dir <绝对目标路径>
```

bootstrap 从本 Skill 的 `resources/ake-source/` 离线资源调用原有 AKE 初始化器。若资源不完整，它会列出确切缺失文件且不写项目文件；按 README 中的官方 Skill 安装说明从 AKE 源码 checkout 恢复/更新 Skill，再重试。初始化不安装任何全局 Skill，也不升级已有项目 CLI。

## 写入结果未知与发布恢复

- 任一写命令返回未知结果（如中断、超时、输出丢失或非零退出但无法确认是否已写）时，禁止盲目重试、重新发布或改参数再跑。先检查真实状态，不能从“没有成功消息”推断零写入。
- `publish` 的未知结果先只读检查实际配置与候选状态：读取项目 `.ake/config.json` 的 `publishLog`；仅当有效配置中该字段不存在时才使用默认 `.ake/publish-log.jsonl`，该相对路径以项目根为基准。若配置不可读/无效或字段值不可解析，不猜默认位置。用 `node .ake/tools/scripts/ake.mjs candidate show <id> --json` 核对候选 `pendingPublication`，检查目标内容 hash 与该实际账本文件。只有当前 CLI 明确支持 `publish --reconcile`，且候选、目标和账本状态一致、待对账 marker/内容 hash 可确认时，才运行 `node .ake/tools/scripts/ake.mjs publish <id> --reconcile`。旧版 CLI 不支持 reconcile、候选/目标/账本状态不符或任何状态无法确认时，不得尝试普通 publish 或其他写命令，停止并报告需人工处理。Reconcile 由 CLI 绑定/hash 门禁完成对账，不得手改 marker/账本。若 reconcile 自身结果未知，重新只读检查实际盘面，不得盲目重复。
- 其他写命令结果未知时先检查其目标状态；只有已证实该具体命令在参数解析阶段拒绝，且执行顺序能证明写入路径尚未开始，才可安全修正参数后重试。普通非零退出、缺少输出或状态不明不构成此证明；无法证明时停止并请用户决定下一步。

程序可测试的行为包括 bootstrap 的 Git 根校验、dry-run、冲突拒绝、离线初始化、既有 CLI/config 保留与路径状态分类，以及 preflight 的 status 路径核验。Agent 执行的实际任务命令单独按其原始结果判断；例如 search 的 query、options、coverage 不得由预检器重造。第三方 Skill 安装器是否分发完整、宿主拒绝是否生效、Agent 是否遵循不绕过提示均不能由这些脚本测试证明；不要将提示规则描述成安全边界。

## 任务前：用户可见通知与按需检索
- 当任务首次进入 AKE 触发阶段（相关工程知识检索或任务后沉淀）时，在首个 AKE CLI 操作前给用户一条简短通知；同一阶段连续进行的多次搜索/候选命令合并在这条通知中，不逐条重复通知。
- Agent Teams 由 Lead/任务 owner 统一发用户通知；成员只将检索/候选结果汇报给 Lead，不各自重复通知用户。
- 在触发的检索阶段，先说明「我会检索 AKE 项目知识并按相关性使用」，再按模块/技术、症状、操作构造具体关键词。若使用既有项目 CLI 且项目根需要确认，先用本 Skill 的 `preflight.mjs --dir <absolute-target>` 核验一次；随后在同一真实 cwd/env 只读运行一次 `node .ake/tools/scripts/ake.mjs --help`，检查其 `search` usage 精确列出了本次命令所需的每个 option 及值形态（包括 `--json`）。若任一所需 option 缺失、help 无法读取或不能解析，停止这次带 options 的 search，告知用户该 CLI 未声明/无法确认支持；不得删除选项、静默降级或再搜索。Help 仅是能力声明，不证明运行行为或安全。通过声明检查后，在相同 cwd/env 运行一次 `node .ake/tools/scripts/ake.mjs search <terms> [options] --json`。记录实际命令的 query/options，并将原始 JSON 的 query、filters、searchedRoots、coverage、coverageReasons、truncated 和 results 一并作为本阶段结果；若要求 `--type`/`--status`，核对 JSON filters 与请求一致，缺失/不符即报告未验证，不重搜。只在触发相关任务时检索，不要求无关任务做空搜索。
- 搜索默认覆盖四类知识根：Agent Notes、Defensive Patterns、Postmortems、Cookbooks；结果须展示/说明类别标签。需要时使用 `--include-candidates`，并可用精确的 `--type`、`--status` 和 `--limit` 缩小结果；status 依文档类型各自权威来源读取，缺失值为 `unknown`，过滤后仍须如实报告筛选范围。
- 默认不设输出预算；确需 `--budget-bytes N` 时，限额只约束 UTF-8 编码的命中 payload，不是完整 stdout/JSON 硬上限。若预算导致结果省略，必须检查 `coverage`、`truncated` 和 `coverageReasons`，向用户提示结果可能不完整，不得当作无命中。
- 命中后只读查看相关文档；判断其 scope、status、verified、证据和当前代码是否仍适用，不把命中视为自动指令。最终报告指出检索词、命中文档/类别及适用性；没有命中只表示“未找到”，不表示知识不存在。

## 任务后：判断是否值得沉淀
- **Agent Note**：有可复用的设计/实现决策、重要取舍或变更依据。按生命周期写入 `.agents/notes/{proposed,implemented,rejected}/{class}/`。
- **Defensive Pattern**：可重复的规则/防错检查，写入 `docs/defensive-patterns/`。
- **Postmortem**：已发生的故障、影响、时间线、根因与护栏，写入 `docs/postmortem/`。
- **Cookbook**：可复用的操作步骤及验证方式，写入 `docs/cookbook/`。

只把有据、可复用的新知识写成候选。普通问答、琐碎改动、没有稳定经验或已被现有文档覆盖时，报告「AKE · 本次无新增知识」。若已发现可能有价值的新知识但核心证据不足，不要误报“无新增知识”：不创建候选，明确标注“潜在知识待补证据”，说明缺少什么以及如何验证。不得编造 scope、evidence、验证日期、会话/事件标识或解决状态。先搜索正式知识及候选，优先修订真正对应的现有目标。候选应对应实际有价值的结果，并用与核心主张相关的 A/B 级证据支持；可追溯证据可以是当前会话中可核对的直接观察，无需额外持久化产物或 ID。按主张选择合适验证；不得声称未执行的测试/检查已运行，也不要求每个候选都必须有实际测试。写明适用范围和验证条件。创建或更新前通知用户「AKE · 准备沉淀为 <类别>：<简要主题>」。使用 `candidate new` 或 `candidate revise`、`candidate submit` 和 `candidate check`；逐项核对格式、目标、链接、重复项、范围、证据、内容哈希和目标哈希。

## 独立审核与发布授权
- **Agent Teams**：优先由未参与候选生成、且适合该领域的独立 reviewer 检查。以真实 reviewer 名称运行 `review <id> --reviewer ... --verdict <approve|request-changes|reject> --notes ...`；不得伪装身份。发出一次请求后，等待该 reviewer 的实际审核结果；派单成功、工具接受或沉默都不是审核完成。若当前轮次无法等待实际结果，暂停并如实告知用户/Lead，不自行假称已审核。
- **Single Session**：有可用独立子代理时，交由未参与生成的 reviewer 审核并等待其实际结果；没有可用 reviewer 时，说明独立审核不可用并暂停，等待安排 reviewer。作者自检可作为补充记录，但不得声称独立，也不得替代所需的独立审核。
- Reviewer 报告使用 `PASS`、`PASS WITH LIMITATIONS`、`BLOCK` 标签；现有 CLI verdict 保持 `approve|request-changes|reject`：`PASS` 映射 `approve`；`PASS WITH LIMITATIONS` 若核心主张有据且限制已明确写入候选，也映射 `approve`；若需先补充/明确限制，则映射 `request-changes`。`BLOCK` 按问题是否可修复映射 `request-changes` 或 `reject`。不要将新标签作为 CLI verdict。
- 证据等级针对候选的核心主张，而非元数据完整度。**A（强直接证据）** = 与主张相关的源代码/差异、实际测试日志、可复现结果，或有意义的前后对比；不相关的代码或测试不能支撑该主张。**B（当前上下文中的可用证据）** = 与主张相关的当前运行/系统状态、实际浏览器检查、此 Session Agent 的直接验证、用户对其意图/验收的确认，或可读取的配置、安装脚本、系统状态。B 不要求持久化材料、独立证据文件、session/event ID，也不要求把会话内直接观察再包装成独立佐证；按主张判断关联性和局限。**C（核心证据缺失）** = 核心主张没有基本相关证据、证据与主张不匹配，或被现有证据反驳。A/B 可支持相关核心主张；C 对核心主张须标 `BLOCK`，并按可修复性映射 `request-changes`/`reject`。缺少 session ID、事件号、独立证据文件或不相关主题本身不降级证据等级，也不构成 BLOCK；不得为了满足字段制造证据。
- 若潜在知识有价值但因 C 级证据不足不能形成候选，报告“潜在知识待补证据”及具体缺口/验证路径，不能说“无新增知识”。`AKE · 本次无新增知识` 仅用于确实没有新的、可复用结果。

- 收到 `request-changes` 后最多自动修订一次，再交由独立 reviewer 实际复核一次；第二次仍未通过就暂停并报告，不循环。CLI 记录 verdict 时保留原有候选状态和绑定门禁。
- Reviewer 通过后，向用户报告候选及限制并等待用户明确授权发布。不得默认自动授权，不得预先运行 `approve --confirm` 或 `publish`。收到明确授权后，使用现有 CLI `approve <id> --by <human> --confirm` 记录授权，再运行 `publish <id>`；`--by` 是声明，不是身份认证。用户未授权时保持未发布，并说明候选 ID、状态和等待原因。
- 内容修改或观察到漂移后，必须按现有门禁重新提交并重新审核；发布仍须保留绑定校验、漂移检测、账本和 unknown-result reconcile。Skill/AGENTS 是软约束，普通文件工具可绕过，不是安全边界。
- 合成回归例（不是已观察事实）：假设本 Session Agent 实际检查 Tampermonkey 目标页面的按钮文字与背景/边框、`::before`/`::after` 伪元素层叠、真实计算样式和下拉交互，且用户确认这些观察；其他页面/菜单主题未检查并已作为限制写明。此即时上下文证据属 B，不要求持久化截图、独立证据文件或 session/event ID；预期 `PASS WITH LIMITATIONS`，映射 CLI `approve`。不能仅因缺少标识/持久化文件或其他主题未验证而 BLOCK。若同一候选对这些核心主张实际没有基本证据（C），则应 `BLOCK`，按可修复性映射 `request-changes`/`reject`。此例为合成测试向量，不是实际浏览器检查或 Tampermonkey 行为验收。


## 触发路由与连续执行能力边界
- 按阶段应用触发并只执行当前阶段适用的步骤：任务前触发只做检索与适用性判断，不启动候选捕获；任务后触发先评估沉淀价值和证据。用户显式调用 `/ake` 时按其请求的阶段执行，不受自动完成语句条件限制。仅在任务后评估确认有据、可复用且未被覆盖的结果时，才继续查重、创建/修订候选和请求独立 reviewer；无价值则报告「AKE · 本次无新增知识」，证据不足则报告“潜在知识待补证据”，不得强制建候选。
- 当前阶段的所有适用步骤一次连续执行，不要在检索、适用性判断、价值/证据评估、查重或合格候选的准备/提交/reviewer 请求之间额外询问“是否继续”。只在必须取得实际 reviewer 回复或用户发布授权时等待；无法等待 reviewer 的真实结果时如实报告，不伪造结果。现有 candidate/submit/review/approve/publish 权限、安全、验证和状态门槛不因连续执行而放宽。
- 自动完成语句路由的条件仅适用于这一个额外的自动信号：此前确有实质工程任务（实现、调试、测试、架构或风险变更），本 Skill 已加载，且用户随后明确说「验证 ok」「测试通过」「没问题了」「验收通过」等。该条件不限制显式 `/ake` 调用或既有适用知识触发。普通问答、解释、无工程产出的对话不因完成语句路由自动进入候选流程；完成确认也不等于发布授权。
- 以上消息判断是模型软约束，不是宿主硬触发。普通语言消息不能保证自动加载本 Skill；显式 `/ake` 可通过宿主机制注入，但不得声称 AKE 能观察所有消息或保证检测任意完成语句。无法确认 Skill 已加载时如实说明。


## 常用命令
- `node .ake/tools/scripts/ake.mjs candidate new --kind <note|defensive-pattern|postmortem|cookbook> --title <title> --author <actual-name> --target <path> --body <file>`
- `node .ake/tools/scripts/ake.mjs candidate submit <id>`
- `node .ake/tools/scripts/ake.mjs candidate check <id>`
- `node .ake/tools/scripts/ake.mjs review <id> --reviewer <actual-reviewer> --verdict <approve|request-changes|reject> --notes <evidence>`；CLI verdict 不接受 PASS 标签
- 仅在用户明确授权发布后：`node .ake/tools/scripts/ake.mjs approve <id> --by <human> --confirm`，随后 `publish <id>`

## 用户可见最终报告
任务结束时简要填写，不隐去未验证项：

```text
AKE 知识流程
- 检索：<关键词>；命中 <类别/文档及适用性>，或未找到
- 沉淀：<Agent Note | Defensive Pattern | Postmortem | Cookbook + 标题/目标>；若潜在知识待补证据，写明证据缺口/验证路径；仅确无可复用结果时写「AKE · 本次无新增知识」
- 检查/审核：<candidate check 结果；独立 reviewer 实际结果，或独立审核不可用并暂停>
- 授权/发布：<用户明确授权后发布，或未授权/未完成审核而保持未发布及原因；候选状态>
- 验证：<实际运行的命令与结果>
- 风险/未验证：<剩余事项>
```

## 边界
AKE 是流程和工具层，不是安全边界。普通文件/shell 工具可绕过流程；身份无法验证，自动授权标记不证明人类授权或审核者真实独立。发布仅对经 CLI 处理的候选执行绑定、格式、目标与漂移检查。
