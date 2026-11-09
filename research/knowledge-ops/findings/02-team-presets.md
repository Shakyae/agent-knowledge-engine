# Agent Team Presets：运行观测、角色边界与降级核查

> 只读源码核查，2026-11-09。事实来自本机 DSH 0.2.2-rc.1 checkout 与已安装 `dsh-agent-team-presets` 0.1.9 的发行 JS；没有运行团队、写入 DSH 配置或做实验。路径均为绝对路径，行号基于当前已安装文件。

## 摘要

**事实：** 当前插件确实具备团队执行的概要观测流、持久成员配置、按角色隔离的 Team Skills、工具 allow-list 与 fail-closed quarantine。但它不是完整活动追踪器：插件暴露给设置页的 execution frame 只含身份/计数，不含 prompt、会话名或内容；具体谁在运行及状态要读 Team roster (`list_agents`)；`spawn_team_member` 的成功响应只是 `active`，失败才标 `failed`，另有 spawn 前的拒绝/抛错路径。配置与技能在成员创建时绑定/冻结，不应假设实时热继承。

**推断：** “角色模板存在”不等于“成员能力已经获得”：执行受当前 Agent preset 实际能力、Team slot policy、调用上下文及插件 runtime/持久化/技能发布状态共同约束。需把 roster 与 Team execution 汇总视图视为互补，而不是把 settings 页面摘要当实时详细状态。

## 1. 源码与版本范围

- Host checkout：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json:1-5` 声明 DSH `0.2.2-rc.1`。
- Host 所含 Agent Teams：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-experimental-agent-team/package.json:1-4`，描述为 implicit-root roster、peer messaging、shared task DAG，版本 `0.2.2-rc.1`。
- 已安装插件：`/Users/shakya/.dsh/profiles/web/node_modules/dsh-agent-team-presets/package.json:1-5` 为 `0.1.9`；`:71-90` 的 peer/engine 范围要求 DSH 与 Team 相关宿主包 `>=0.2.2-rc.1 <0.3.0`。
- checkout `lib` 无可定位的 Team 源码副本；以下插件证据来自已安装包的 `/Users/shakya/.dsh/profiles/web/node_modules/dsh-agent-team-presets/lib/index.js`（构建产物，非独立源码仓库）。因此不能把插件 JS 当作源码映射后的 TS 行号。

## 2. 当前 Session：可观察什么、不能观察什么

### 已证实

1. 插件 execution monitor 注释说明它以 captain status 与 roster teammate phases 计算状态，发布**全量 frame 而非 delta**；丢帧后下一 frame 仍可恢复状态。frame 只带 identities/counts，不外发 persona、session name 或 session content。见 `.../lib/index.js:7360-7366`。
2. 是否有运行/准备中的 teammate，以 `agentTeams.listMembers(agent)` 中 `role === "teammate"` 且 `status` 为 `running|provisioning` 判断；注释明确 roster 汇总 durable `team/member` events，子会话创建前可能尚无 `agent/status`，所以 roster 是该阶段的权威来源。见 `:7377-7389`。
3. 设置端 `execution(signal)` 返回全量流，首帧就是当前状态；状态不确定保留 `unknown`，不伪装 idle。保存变更只有在下一任务前采用。见 `:18516-18527`。
4. 配置应用期间可 quarantine。Captain 仅放行不授予能力的恢复/协调工具（包括 `list_agents`、task board）；成员无例外、quarantine deny-all；`spawn_team_member`/`spawn_teammate` 都不是恢复豁免。见 `:826-853`。
5. `list_agents` 是 prompt 明确要求读取 live roster/status 的接口；插件注释还区分 role template 与实际实例 target，且同 role 可多实例。见 `:320-345`。

### 反例 / 限制

- `TEAM_APPLICATION_MARKER`（请求头中的 `spawn_team_member` 工具）只能作为**正向证据**：false/missing 不证明无 Team；PTC presentation fold 和 all-mode Team 会造成真实 Team 却无 marker。见 `:7392-7414`。
- 插件报告明确警告 `list_agents` roster 的 model 字段可能是父会话 fallback，不可作实际模型路由证据；优先 `spawn_team_member.configuredRoute`、成员 session `model/selection`、首个 `request/header.config`、成员快照 route。见 `:1492-1496`、`:1555-1562`；这也是独立于状态观察的展示误差反例。
- frame 是摘要而非逐成员 transcript：不能从其判定某成员读了什么 prompt、是否真正收到 skill、工具调用/结果内容或审查质量；要查看 roster 状态与成员自己的会话/持久快照。frame 不携带内容是明确隐私边界，见 `:7360-7365`。

## 3. Prompt、Skills、模型路由和权限传递

### Prompt / 上下文

- Captain briefing 拼接 Team 描述、队长身份、固定 summon target 和成员说明，并指定 `spawn_team_member(member, task)`。见 `:245-268`。
- 新成员 persona 是 Team 身份、该成员 role 描述、该成员 systemPrompt；成员 team-context 另列职责分工，但不把队长 roster/summon 指令或 sibling 的完整 standing prompt 全塞给成员。见 `:271-291`、`:320-345`。
- spawn 输入契约 `member`, `task` 必填；`description` 可选；`context` 为 `fresh|fork`，默认 fresh。fresh 不继承队长历史，fork 继承其 completed turns。`task` 文本必须带齐成员所需事实。见 `:1273-1300`。
- spawn 前先持久化 persona、teamSection、roster、route、policy、spawnContext，之后才 `spawnTeammate`；快照失败就拒绝创建，避免成员以队长 route/无限制工具启动。见 `:1260-1264`、`:1334-1364`。

### Skills

- Team Skills 为插件私有库并按 Team/role 绑定到成员 Agent scope；库列表不是成员可见性证明。`list_team_skills` 文案称仅分配到该 Agent 的技能可见，绝不全局注册；见 `:18052-18082`、`:18143`。
- 技能 provider 在 Agent scope 注册；如果角色有已分配技能而发布失败，成员创建会被拒，防止以空 skill catalog 启动。见 `:16670-16695`、`:18722-18736`。
- `skill` 是隐式工具，不列入可配置 allow-list，因为 Team policy 总是允许它；但这并不表示任意 Team Skill 内容自动传给所有角色。见 `:18468-18476`。
- **未证实/假设：** 本次未读取当前某成员 snapshot、bindings 文件或子会话日志，故不能断言本 Session 中具体某角色已有何技能或实际请求收到哪些 skill 内容。

### 权限 / 执行能力

- slot tool mode 默认为 `all`（tools 为空）或 `custom`（有 tools），policy 由 Team id、mode、allow 列表构成。见 `:51-52`、`:869-873`。
- custom policy 必须在当前 caller 可达的能力范围内；插件会按当前 Agent preset 能力预检，catalog 是所有 Agent preset 的并集，不是当前 Session 实际工具集。预检失败则拒绝，不偷偷授予。见 `:1185-1212`、`:18479-18505`。
- custom 成员生成前还要求 native presentation；PTC 情况不能安全恢复继承 executor 时会拒绝。见 `:1314-1317`；all mode 不要求此 custom allow-list 过程，不能由此推断其工具能力被收窄。
- 主插件层把 `spawn_teammate` 拦截为“preset-managed creation，使用 `spawn_team_member`”；成员不能再创建成员；direct solo member 没有 Team Lead/召唤工具。见 `:914-920`、`:293-317`。

## 4. 独立审核与单发布者

- 插件内置研发团队预设给 reviewer 的职责是独立审查实际变更，默认只读、不改共享生产实现；要求核对测试是否触达目标路径、报告证实缺陷/待验证风险/建议，并由队长裁决风险。`.../lib/index.js:6493-6496`。
- 同一预设的 captain 指定 executor 实现测试、reviewer 独立审查，并要求 push、发布、改写历史分别取得授权；但这是提示词政策，不是插件硬性授权隔离。见 `:6480-6482`。
- 插件有 `CAPTAIN_ONLY` 能力目录标记，可提示队长专属工具，见 `:18507-18514`；当前证据不足以证明这替代宿主工具授权或阻止拥有 all-tools 的成员通过其他可达工具写文件/提交。
- **推断/建议：** 若需可靠“独立审核 + 单发布者”，按 prompt 指定 reviewer 只读并让 captain 唯一整合/发布，同时在工具 policy/宿主权限层落实 reviewer 无写能力、成员无发布凭据；不要把角色描述当安全边界。源码显示插件策略能限制工具，但 prompt 本身只表达行为意图。

## 5. 故障与降级

| 条件 | 已证实行为 | 证据 |
|---|---|---|
| 没有 preset member runtime | spawn 拒绝；不创建无冻结配置成员 | `:1318` |
| durable store 无法用 | 拒绝创建，而不回退为队长 route/unrestricted tools | `:5928-5931` |
| provider/context/depth 或 route 不可用 | spawn 前拒绝；分类错误后将成员 lifecycle 标 failed | `:1319-1343`、`:1380-1385` |
| Skill bindings/发布不可用 | 有分配但目录未发布则拒绝成员创建；没有分配才可无技能运行 | `:18722-18736` |
| Team 运行中更改定义 | captain persona、briefing、roster、tool scope、allow-list 冻结到任务边界；未知状态不当 idle | `:19210-19239`、`:18519-18522` |
| quarantine / 不能证明有效 policy | 暂停能力工具；root 保留恢复工具，成员 deny-all；父 policy quarantine 时 child creation 拒绝 | `:826-853`、`:18824-18827` |
| create tool 返回 | active/failed，另可返回 configuredRoute；工具拒绝/异常可能直接抛错 | `:1372-1385` |

整体倾向 **fail closed**：不以默认队长配置兜底创建、不用空技能目录假装成功、配置不确定时不放行能力工具。代价是服务/存储/skill provider 缺失会降低可用性并中断召唤；安全优先于透明降级。

## 6. 尚未从源码事实推出的事项

- 当前活跃 Team、当前各成员 status、已发布的角色技能绑定与实际成员执行模型：必须结合当前 Session roster、member snapshot、session event/request header；本次未读取用户运行态记录。
- “独立审核一定发生”或“只有队长能发布”：built-in prompt 说明角色期望，不是执行证明；需工具 policy 和实际变更链路复核。
- 本地 Homebrew 安装 checkout 的完整宿主 Agent Teams 实现未进一步追踪到 TS 源码映射；仅核对了包版本/职责说明以及插件侧调用点，不将 prompt 规范当成宿主强制保证。
