---
name: ake
description: 在实现、架构、排障、部署、风险变更前检索工程知识，任务后按四类知识流程捕获、检查、审核并发布时使用。
---

# AKE knowledge operations

先确定目标项目的绝对路径，并使用 Skill 加载器提供的 **本 Skill base directory** 绝对路径；不得从当前工作目录、目标项目或 AKE 源码 checkout 推导 Skill 路径。若加载环境未提供该绝对路径，先请用户提供/确认已安装 Skill 的位置，不要猜路径。

## 项目初始化（按需）

首次检查用下面的 `bootstrap.mjs --dry-run` 对目标做只读预检；不要把继承 `GIT_*` 环境的普通 shell `git` 结果当作授权依据。Bootstrap 清理全部 `GIT_*` 环境变量后再检查：目标可以是独立 Git 工作树根目录，也可以是已有父级工作树中的项目子目录；它只在用户给定的确切目录初始化，不向上迁移、不创建嵌套 Git 仓库，也不运行 `git init`。若结果明确为非 Git 工作树，询问用户是否先选择/初始化 Git 项目；只有用户确认且目录已由用户建立为有效工作树后才重试。缺少 Git、bare 仓库或其他 Git 检查错误时，不得推测可新建，停止并报告原因。检查失败时零写。

如果目标中 `.ake/config.json` 与 `.ake/tools/scripts/ake.mjs` 都是现有文件，视为已初始化：不要重复运行 bootstrap、不要复制或升级配置/CLI。bootstrap 仅安全读取 config 版本与随附 bundle 的 package 元数据并报告是否不同；它不会执行项目 CLI，且不能由 config 版本证明 CLI 本身的版本。无法判断时明确报告未知。旧版或版本未知的项目 CLI 在任何写操作前，要求用户自行运行只读 `node <绝对目标路径>/.ake/tools/scripts/ake.mjs status --json`，确认返回的 `project` 精确等于目标绝对路径；Agent 不自动执行现有项目 CLI，也不在未确认前执行写命令。若项目根错误，先备份并让用户人工审阅当前官方 AKE 版本的迁移/合并方案；不要自动复制、升级或覆盖项目 CLI、配置、知识文件。确认后才可使用该项目自己的 CLI。

若缺任一文件，使用本 Skill 随附的离线资源执行器，不依赖 AKE 源码 checkout 或调用时的工作目录。先展示计划：

```bash
node <本 Skill base directory 的绝对路径>/bootstrap.mjs --dir <绝对目标路径> --dry-run
```

dry-run 若报告任何 `conflict`，停止并报告冲突路径；不要应用部分计划。无冲突后再应用：

```bash
node <本 Skill base directory 的绝对路径>/bootstrap.mjs --dir <绝对目标路径>
```

bootstrap 从本 Skill 的 `resources/ake-source/` 离线资源调用原有 AKE 初始化器。若资源不完整，它会列出确切缺失文件且不写项目文件；按 README 中的官方 Skill 安装说明从 AKE 源码 checkout 恢复/更新 Skill，再重试。初始化不安装任何全局 Skill，也不升级已有项目 CLI。

程序可测试的行为包括 Git 根校验、dry-run、冲突拒绝、离线初始化和既有 CLI/config 保留；“非 Git 时询问用户”是本 Skill 对 Agent 的软指令，不能由脚本或自动化测试证明真实 Agent 会遵循。不要把提示规则描述成安全边界。

## 任务前：用户可见通知与按需检索
- 当任务首次进入 AKE 触发阶段（相关工程知识检索或任务后沉淀）时，在首个 AKE CLI 操作前给用户一条简短通知；同一阶段连续进行的多次搜索/候选命令合并在这条通知中，不逐条重复通知。
- Agent Teams 由 Lead/任务 owner 统一发用户通知；成员只将检索/候选结果汇报给 Lead，不各自重复通知用户。
- 在触发的检索阶段，先说明「我会检索 AKE 项目知识并按相关性使用」，再按模块/技术、症状、操作构造具体关键词执行 `node .ake/tools/scripts/ake.mjs search <terms>`。只在触发相关任务时检索，不要求无关任务做空搜索。
- 搜索默认覆盖四类知识根：Agent Notes、Defensive Patterns、Postmortems、Cookbooks；结果须展示/说明类别标签。需要时使用 `--include-candidates`，并可用 `--type`/`--limit` 缩小结果。
- 命中后只读查看相关文档；判断其 scope、status、verified、证据和当前代码是否仍适用，不把命中视为自动指令。最终报告指出检索词、命中文档/类别及适用性；没有命中只表示“未找到”，不表示知识不存在。

## 任务后：选择四类之一
- **Agent Note**：有可复用的设计/实现决策、重要取舍或变更依据。按生命周期写入 `.agents/notes/{proposed,implemented,rejected}/{class}/`。
- **Defensive Pattern**：可重复的规则/防错检查，写入 `docs/defensive-patterns/`。
- **Postmortem**：已发生的故障、影响、时间线、根因与护栏，写入 `docs/postmortem/`。
- **Cookbook**：可重复的操作步骤及验证方式，写入 `docs/cookbook/`。

只捕获有证据、可复用的结果，不为每个任务强行生成文档，不编造 scope、evidence、验证日期或解决状态。先搜索现有知识及候选，优先修订适当的既有目标；候选须含可追溯证据、scope 与验证条件。在创建/更新候选之前，先向用户通知「AKE · 准备沉淀为 <类别>：<简要主题>」，同阶段后续命令不重复通知。使用 `candidate new`/`candidate submit`，并用 `candidate check` 逐项核对文档格式、目标、链接、重复项、范围、证据、内容哈希与目标哈希；不通过就修正并重提。若没有新增知识，最终必须输出「AKE · 本次无新增知识」；若有未发布候选，在同一通知中简述候选 ID、未发布原因或等待的审核状态。

## 审核与本地自动发布
- **Agent Teams**：优先由未参与候选生成、且适合该领域的独立 reviewer 检查。以真实 reviewer 名称运行 `review <id> --reviewer ... --verdict approve --notes ...`；不得伪装身份。通过后默认本地自动授权并发布，无需额外等待人工授权。
- **Single Session / 无适合 reviewer**：明确通知用户这是作者自检而非独立审核。完成结构化自检（范围与证据、格式与链接、重复/影响、反例与验证结果、目标现状），用 `review <id> --self-review --verdict approve --notes "..."` 记录真实作者身份。随后默认本地自动授权并发布，不要求用户再选择自动模式。
- 默认自动授权通过 `approve <id> --confirm`（可显式写 `--automatic`）记录 `mode: automatic`，不伪称人类授权。为兼容既有人工流程，只有用户明确要求人类授权时才使用 `approve <id> --by <human> --confirm`。
- 任何模式都必须维持候选状态转换、完整 content/target/targetHash/operation 绑定、验证和目标漂移检测、发布账本及不确定结果的显式 reconcile。修改内容或发现漂移后必须修订并重新提交、重新审核/授权；禁止盲目重试、直写正式知识或绕过门禁。
- 作者不得把自检描述成独立审核；独立性与身份无法由 AKE 验证。Skill/AGENTS 是软约束，普通文件工具可绕过，不是安全边界。

## 常用命令
- `node .ake/tools/scripts/ake.mjs candidate new --kind <note|defensive-pattern|postmortem|cookbook> --title <title> --author <actual-name> --target <path> --body <file>`
- `node .ake/tools/scripts/ake.mjs candidate submit <id>`
- `node .ake/tools/scripts/ake.mjs candidate check <id>`
- `node .ake/tools/scripts/ake.mjs review <id> --reviewer <actual-reviewer> --verdict approve --notes <evidence>` 或显式 `--self-review`
- 默认本地自动授权：`node .ake/tools/scripts/ake.mjs approve <id> --confirm`，随后 `publish <id>`（`--automatic` 可显式注明）
- 仅当用户要求人类授权时：`node .ake/tools/scripts/ake.mjs approve <id> --by <human> --confirm`

## 用户可见最终报告
任务结束时简要填写，不隐去未验证项：

```text
AKE 知识流程
- 检索：<关键词>；命中 <类别/文档及适用性>，或未找到
- 沉淀：<Agent Note | Defensive Pattern | Postmortem | Cookbook + 标题/目标>，或说明无可复用结果
- 检查/审核：<candidate check 结果；Team 独立 reviewer 或 Single Session 作者自检（明确非独立）>
- 授权/发布：<automatic / 明确要求的 human / 未发布及原因；发布目标或候选状态>
- 验证：<实际运行的命令与结果>
- 风险/未验证：<剩余事项>
```

## 边界
AKE 是流程和工具层，不是安全边界。普通文件/shell 工具可绕过流程；身份无法验证，自动授权标记不证明人类授权或审核者真实独立。发布仅对经 CLI 处理的候选执行绑定、格式、目标与漂移检查。
