# DSH 官方工程知识管理体系的通用化与自动化：技术调研报告

> 调研对象：`github.com/deepseek-ai/deepseek-harness`，默认分支 **master**，tree `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，最后推送 2026-11-04；本机运行时 **DSH 0.2.2-rc.1**（Web profile）。
> **本轮只读**：未改任何 DSH 配置、未安装插件、未起后台服务、未改工作区既有文件。团队成员仅写入 `tmp/scratch/<member>/findings.md`。
> 证据分级：**【已验证】**=读了源码/原始文档原文；**【推断】**=由已验证事实推得；**【未验证】**=静态条件下无法确认。
> 环境约束（影响证据强度）：本机 shell TLS 出网失败（`curl`/`Invoke-WebRequest` 均失败），全部 GitHub 内容经 `web_fetch` 获取；**所有官方脚本均未实跑**，脚本可用性为源码静态判定。

---

## 1. 执行摘要

**结论先行：值得建设，但要做的是「规则 + 格式 + 两段式流程」，不是「自动记忆系统」。官方没有可直接安装的知识管理产品；DSH 运行时却已经把「自动加载」这半个问题解决好了，真正的缺口只在「写什么、谁批准」。**

1. **官方那套东西是真的、是活的，但它是一个「pnpm monorepo 贡献者体系」，不是可整体搬走的产品。**【已验证】
   五类知识都在（`.agents/notes/`、`docs/defensive-patterns/`、`docs/cookbook/`、`docs/postmortem/`、`docs/agent-lifecycle.md`），但每一个都绑定本仓门禁脚本、CI、双语配对与 `packages/` 布局。可搬的是**结构、格式、规则文字、少量脚本**；不可搬的是门禁全链路、i18n sidecar、哈希冻结、仓库专属类目。
   规模参考（反证组统计）：defensive-patterns 5 篇、cookbook 13 篇、postmortem 4 篇；`archived/architecture` 单类 ≥109 篇。**把这套讲成「完整知识工程体系」是虚高，把它讲成「五份精选规则 + 一套纪律」才准确。**

2. **「自动加载」不需要开发——DSH 安装后默认就有两层。**【已验证】
   - 分层 `AGENTS.md`/`CLAUDE.md`：`dsh-base` 默认挂载 `dsh-agent-instructions`，**每条指令链 65,536 字节预算**，用户全局链 `~/.dsh/AGENTS.md` → `~/.agents/AGENTS.md`，项目链从 `.git` 根到会话 cwd，含 `.local.md` overlay、同内容去重、嵌套目录按文件系统触达增量注入。
   - 项目级 Skills：`dsh-skill-filesystem` 按 rank 扫描 `<project>/.dsh/skills`(100) → `<project>/.agents/skills`(200) → custom(300) → `~/.dsh/skills`(400) → `~/.agents/skills`(500) → bundled(600)；模型只看到「名称 + ≤500 字符描述」的目录，正文按需 `skill` 加载。
   - 历史经验检索：本 profile 的 `package.json` 显式启用了 `@deepseek-ai/dsh-experimental-session-search`（SQLite FTS5），本会话工具面里就是 `session_search` / `session_event_search`。**再设计索引库/向量库属于重复造轮子。**
   - ⇒ 这正好对上用户原则「优先用官方已有架构」：**别再造记忆系统，直接用它已经认识的两种文件。**

3. **「.agents/notes/ 会被自动注入」是错的，而这个「错」是好事。**【已验证】
   运行时只自动读 `AGENTS.md` 链与 skill 目录。`.agents/notes/**` 是**纯 Markdown**，不占任何常驻上下文；它只在下述三种情况进入模型：①人/agent 用 `read` 打开（read 到 `.agents/notes/` 下会触发该目录 `AGENTS.md` 的嵌套注入）；②某个 skill 正文引用它；③`session_search` 检索到相关历史。
   ⇒ 这就是官方对「上下文膨胀」的答案：**常驻只放规则，知识全部按需读。**

4. **官方没有任何「会话结束自动沉淀」的实现。**【已验证】
   仓库里唯一接近的是 `docs/cookbook/maintaining-dsh-code-review.md` 描述的私人单运营者流程（人工分类 → 生成候选 → doc-sync/lint → 人工查来源 → 提 PR），且其关联 note 仍为 `proposed`，属私有基础设施。**不要把它当成官方已交付能力。**
   而自己写钩子会踩实打实的坑：`agent/pre-step` 是 waterfall 且被 `await`（每步阻塞）、`agent/turn-stopping` 是 serial 且被 `await`（卡回合收尾）、没有独立「会话结束」事件、Goal 自动续轮与 Team mailbox 会造成递归触发、team 并发写同一文件无文件系统版本保护。**结论：不做逐回合自动写入。**

5. **最便宜且有效的自动化是「零代码」的：** ①在根 `AGENTS.md` 写一条常设指令（任务收尾时把候选写进 `.agents/notes/proposed/`，并明确禁止自批 `Status: implemented`）；②做一个 `.agents/skills/knowledge-capture/SKILL.md`，其 description 携带触发词（官方 skill 目录**不渲染 `whenToUse`**，路由只看 name+description，所以触发词必须写进 description）；③需要批量巡检时才用官方 `schedule`（进程内定时 + 持久化，重启后只补最近一次错过，宿主必须运行）。

6. **落地前必须先解决一个前置事实：当前工作区 `H:\Dev\dsh-lab` 不是 git 仓库，也没有 `.agents/`、`.dsh/`。**【已验证】
   纯 Markdown + Git 方案的第 0 步是版本控制。本轮不改工作区状态，故**未执行 `git init`**，列为第一步动作。

---

## 2. 官方已有能力清单

### 2.1 A 类：安装 DSH 后默认就有，**原样复用，零开发**

| 能力 | 实际位置 | 作用 | 依据 |
|---|---|---|---|
| 分层 `AGENTS.md` 加载 | `dsh-base/cordis.patch.yml:307-308` → `@deepseek-ai/dsh-agent-instructions` | 常驻规则自动注入，65,536 B/链，`.git` 定根，`AGENTS.md`/`CLAUDE.md` + `.local` | 包内 `README.zh.md`（配置表 + 预算回退规则）【已验证】 |
| 项目/用户级 Skill 发现 | `dsh-base/cordis.patch.yml:312-319` → `dsh-skill` + `dsh-skill-filesystem` + `dsh-tool-skill` | `.agents/skills/<name>/SKILL.md` 即插即用，实时 watch，rank 100–600 | `dsh-skill-filesystem/README.zh.md:44-77`【已验证】 |
| Skill 目录渐进披露 | `dsh-tool-skill/README.zh.md:54-56,142-145` | 模型只收「名称+≤500 字符描述」，正文按需加载；正文无大小上限 | 同左【已验证】 |
| 历史会话检索（FTS5） | profile `package.json` bundles 含 `dsh-experimental-session-search` | `session_search`/`session_event_search`，无需自建索引 | 本 profile 配置 + 本会话工具面【已验证】 |
| 上下文压缩 | `dsh-compaction-basic`（preset `standard` 内挂载） | 会话内上下文治理解，不承担知识持久化 | 本仓前一轮报告 `REPORT.md` §2【已验证】 |
| 定时任务 | `dsh-schedule` | 按时把指令投递进 Session（可 `this_session`/`new_once`/`new`），重启后保留、只补最近一次 | 包内 `README.zh.md:12,53,229,280`【已验证】 |
| Agent Teams | `dsh-experimental-agent-team` + 本机 `dsh-agent-team-presets` 插件 | 具名 teammate、inbox、持久共享任务板（CAS + writeScopes 只是提示） | 包内 `README.zh.md:12,72-76,136`【已验证】 |
| 文档分层与写作标准（**照抄文字即可**） | `docs/AGENTS.md`：tier taxonomy 表、writing rules、word count budgets、slop checklist | 「一事实一个 home」+ 根 AGENTS.md ≤2,080 词等硬预算 | 原文【已验证】 |

### 2.2 B 类：需要少量适配（把官方仓库资产搬进普通项目）

| 资产 | 路径 | 复用等级 | 具体改动 | 平台风险 |
|---|---|---|---|---|
| 笔记格式门 | `scripts/agent-note-tree.ts`、`verify-agent-note-format.ts`、`verify-agent-note-classification.ts` | 小改 | 改 `agentNoteRoot`、`AGENT_NOTE_CLASSES`（六类）、`FORMAT_ADOPTED` 常量；去掉「禁 `docs/rfc`」等本仓规则 | **CRLF 必挂**（逐行比较） |
| 链接/换行门 | `scripts/verify-md-links.ts`、`verify-md-wrap.ts` | 小改 | 改 `PATTERNS` glob；必须同拷 `scripts/markdown.ts`、`scripts/repo-files.ts` | 无 |
| 文档词数预算 | `scripts/verify-doc-budgets.ts` + `scripts/doc-budgets.manifest.json` | **原样** | 只改 manifest 的 `{path: 上限}`；BOM 会让词数 +1 | 无 |
| 归档封印门 | `scripts/archived-agent-notes.ts`、`verify-archived-agent-notes.ts`、`archived/AGENTS.md`、`manifest.json` | 小改（建议二期） | 删写死的 figma 豁免哈希；改 `manifestRepoPath`/`archiveRoot`；`DSH_ARCHIVE_BASE_REF` 由 CI 传 base sha | 需 git 在 PATH |
| `dsh-archive-agent-notes` | `.agents/skills/dsh-archive-agent-notes/SKILL.md`（6,721 B，单文件） | 小改 | ①description 去掉 `in deepseek-harness`；②`../../notes/README.md` 等相对路径换项目路径；③第 4–5 步 `pnpm run verify-archived-agent-notes`/`doc-sync`/`lint` 换项目命令；④删 `../dsh-pre-push-checks/` 链接 | git 依赖；CRLF 改变 blob/sha256 |
| `dsh-doc` | `.agents/skills/dsh-doc/SKILL.md`（18,418 B）+ `references/`5 + `templates/`8 | 小改 + 局部重写 | 重建 kind→模板表（删 persistence-*/upgrade-guide）；替换全部 `pnpm run test:docs/doc-sync/lint`；删 Website 投影整节 | 无 |
| `dsh-code-review` | `.agents/skills/dsh-code-review/SKILL.md`（12,111 B） | 重写（留骨架） | 换 11 条 Sources of truth；`pnpm --silent run change-scope` → `git diff base...HEAD`；删 6 个 `../dsh-*` 交叉引用；**「Manual checks 16 维度」与「缺陷四要素」可原样保留** | 无 |
| `agent-experience` | `packages/preset/agent-preset/skills/agent-experience/SKILL.md`（2,093 B） | **原样** | 无 DSH 专属路径/命令；但 `.agents/skills/agent-experience/SKILL.md` 是 **symlink（mode 120000, 70 B）**，Windows `core.symlinks=false` 会退化成路径文本并被运行时静默丢弃 | 见左 |
| 行尾纪律 | `.gitattributes`（`* text=auto eol=lf`，`*.cmd` 例外） | **原样（必抄）** | 无 | 没有它，字节级门在 Windows 全红 |
| pre-commit 编排 | `lefthook.yml` | 小改 | 删 bash 的两条 guard、provider metadata；`pre-push.typecheck` 换项目命令 | 其余 job 是 tsx，不需 bash |

### 2.3 C 类：官方**没有**对应能力（必须自研或人工）

| 需求 | 官方现状 | 判断 |
|---|---|---|
| 任务/回合收尾时自动生成知识候选 | 无。仅 `docs/cookbook/maintaining-dsh-code-review.md` 的**私有**流程（且关联 note 为 `proposed`） | 需自研触发；但**零代码可用 AGENTS.md 指令 + skill** 覆盖 80% |
| 经验 → 候选 → 验证 → 审核 → 晋升 的自动状态机 | 无。官方靠**人和门禁**：格式门管形状，人管真伪与取舍 | 不要造状态机；用「目录 + Status 行 + 人工 `git mv`」 |
| 知识去重/矛盾检测（语义层） | 无。官方纪律是「一事实一个 home」+「搜索特征短语」+ `verify-md-links` | 人工 + 一条 checklist；不值得上 embedding |
| 知识过期/衰减提醒 | 无。官方用 `archived/` 冻结 + 评审，不做过期扫描 | 二期可选：巡检时按日期列出「>N 月未触碰的 implemented note」 |
| 会话结束事件钩子 | 无独立事件，只有 `session/disposed`（此时模型已不可用） | 不做逐回合钩子 |
| 跨仓/跨项目推广 | 无 | 人决定；推广=复制+改写路径 |

---

## 3. 官方工程知识架构分析

### 3.1 五类知识的归属（官方原表 + 我的归纳）

官方「一事实一个 home」表（`docs/AGENTS.md`）不是分类趣味，而是**排他性职责划分**，直接决定「这条经验该写哪里」：

| 层 | 唯一的职责 | **明确不属于它的内容** |
|---|---|---|
| 根 `AGENTS.md` | 常设命令：**每个会话都必须进上下文**的规则，每条 1–3 行，并链接其 home | 故事、worked example、情境化流程、任何从链接处复述来的内容 |
| 子树 `AGENTS.md`（`packages/`、`docs/`、`.agents/notes/`） | 该子树专属命令 | 根文件已承载的全仓规则 |
| `architecture.md` | 有序地图（组合、核心包、循环、seam） | 类型定义、单包细节、决策理由、**实现状态标注** |
| `subsystems/` | 每子系统一页参考：类型、语义、生成的 Cordis API | 行为叙述 |
| **Agent Notes** (`.agents/notes/`) | 活跃决策记录：why、放弃了什么、要求的验证；`implemented/` 用现在时描述已落地现实 | 迁移计划、验收清单、fixture 走读、已落地后的「should…」式 spec-speak |
| **defensive-patterns/** | **本仓在 review 中强制执行的规则**，按改动对象切分（1 篇 general + 5 篇 domain） | 类型定义与语义、决策理由 |
| **postmortem/** | 事故故事——**唯一**允许战争叙事的层；编号 `0001–0004` 索引 | — |
| **cookbook/** | 带编号验证步骤的 how-to | 设计理由（链接到对应 Agent Note） |
| Skills (`.agents/skills/`) | 可复用工作流与专业判断标准 | 产品与运行时契约 |

**一句话路由**：bug → postmortem；理由 → Agent Note；步骤 → cookbook；类型 → subsystems；包契约 → README；常设规则 → 根 `AGENTS.md`（附理由链接）；**review 强制规则 → defensive-patterns**。

### 3.2 五类的相互关系

- **Agent Note 是「理由的唯一 home」**：cookbook 与服务文档只写「怎么做」，理路由 note 承载，且 note 被 supersede 时读者能顺着链接找到现状。
- **defensive-patterns 是「规则的唯一 home」**：根 `AGENTS.md` 只放 1–3 行摘要 + 链接，不复述。
- **postmortem 是「叙事的唯一 home」**：它链接 guardrails（即 defensive-pattern 或门禁），事故教训落地成规则而不是留在故事里。
- **cookbook 是「程序的唯一 home」**：可重复执行的验证步骤只在这里。
- **AGENTS.md 是路由器**：只做「必须常驻的短规则 + 指针」，这一层有 **≤2,080 词**的硬预算并由 `verify-doc-budgets` 强制（`doc-budgets.manifest.json`）。

### 3.3 生命周期（官方实际执行，不是我的发明）

- **状态只有三个**：`proposed` / `implemented` / `rejected: <原因>`。**没有 `accepted`，也没有 `superseded` 字段**；文件头是普通 Markdown 标题 + 空行 + `Status:` 行 + 空行，**不是 YAML front-matter**。
- **六类目录**：`feature` / `bug-fix` / `simplification` / `architecture` / `process` / `testing`；路径 `{proposed|implemented|rejected}/<class>/YYYY-MM-DD-<slug>.md`。
- **晋升**：重大未实施 → `proposed`；可直接记录已交付决定 → `implemented`；`proposed → implemented` 时**同一次移动**并把 `## Proposal` 改写成现状 `## Decision`。
- **否决**：不采用 → `rejected`，状态行带拒绝原因，**保留提案原文**（便于日后反悔时看到当初理由）。
- **更新**：已实施事实变更**同变更更新**；但**决策反转需新 note + 双向链接**，不得就地改写历史。
- **替代**：必须先把旧 note 的全部独特理由/验证搬走、修好入链，才能合并删除；部分替代继续交叉链接。
- **归档**：仅「已完成、指导价值低但历史有价值」的 `implemented` 才归档到 `archived/<class>/`（**故意没有 `implemented` 层**），加 `Archived: YYYY-MM-DD`（不早于文件名日期）+ git blob sidecar + `manifest.json`（sha256，只许追加）⇒ **永久冻结**。`proposed` 不得归档；`rejected` 无防误导价值则直接删除。
- **格式/一致性强制**：`verify-agent-note-format`（4 行头、`## Problem` 必首、分状态必填节、implemented 禁 `## Proposal/Plan/Acceptance criteria`）、`verify-agent-note-classification`（路径↔状态↔类目）、`verify-md-links`（相对链接 + 锚点）、`verify-doc-budgets`（词数天花板）、`verify-translation-pairing`（en/zh 配对）、归档哈希门；`lefthook.yml` 在 commit 前跑，CI 在 PR 上跑。**禁止 `INDEX.md`**——索引靠 `README`/AGENTS 与相对链接，不靠中心表。**【已验证：脚本文本 + 配置；未验证：CI 实际接线是否与 `run-gates.ts` 完全一致】**

### 3.4 如何避免重复、矛盾、过期（官方手段，按有效性排序）

1. **排他性 home + 复述禁令**（最强，靠评审与 slop checklist 执行）：重述即缺陷，slop checklist 明确点名「Duplicated rules / History outside its permitted tier / Hand-restated catalogs」。
2. **单面状态权威**：文档里禁止「implemented!」「future: …」这类状态标注（会腐烂），状态由目录与包清单承载。
3. **冻结代替清理**：归档区加哈希封印，杜绝「悄悄改历史」。
4. **搜索特征短语**：slop checklist 要求「search a distinctive phrase; keep one home and link the rest」——这是纯人工/agent 动作，没有脚本。
5. **词数预算**：让「不断往里加」在物理上不可能。

⇒ 注意 1/4 两条**没有自动化**，是纪律；这正是「自动沉淀」最容易破坏的地方。

### 3.5 什么进 AGENTS.md、什么按需读

官方原文（`docs/AGENTS.md`）：根 `AGENTS.md` 放「rules an agent needs in context in every session, **one to three lines each, linking its home**」，排除「Stories, worked examples, situational procedures, anything restated from a linked home」。
判据可操作化成一句：**「如果这条内容在本次会话里用不上，写进去就是错的。」**
配套事实（`dsh-agent-instructions/README.zh.md`）：预算超限时**先丢宽泛文件、最后截断最具体文件**，并插入 `Workspace instruction budget ...` 通知，超预算的宽泛文件在刷新期间「视为暂时不可用」。**这意味着把知识塞进 AGENTS.md 会静默降级，而不是报错。**

---

## 4. 官方 Skills 与验证工具分析

### 4.1 Skills 实际位置（先纠正三个常见假设）

- 唯一真目录是 **`.agents/skills/`**（21 个 skill + `.gitignore`）。`.claude/skills` 是 **git symlink（17 B → `../.agents/skills`）**，不是第二份副本。
- 另有 4 个**产品预设** skill 在 `packages/preset/agent-preset/skills/`（属产品能力，不属于工程知识体系）。
- ⚠️ `.agents/skills/agent-experience/SKILL.md` 本身是 symlink（mode `120000`，70 B）。Windows 克隆若 `core.symlinks=false`，它退化为 70 字节路径文本 → 运行时按「缺 frontmatter」**静默丢弃**（只 warn，模型侧无诊断）。
- **`.claude/skills` 的 symlink 恰好证明官方的跨 agent 意图**：一份 skill 同时服务多个 agent，而不是各存一份。

### 4.2 运行时 vs 惯例（这是「能不能直接复制」的分界线）

| 层 | 谁强制 | 内容 |
|---|---|---|
| **运行时强制** | `dsh-skill-filesystem` / `dsh-skill` | frontmatter 首行 `---`（容忍 CRLF）；`name` kebab-case；`description` 非空；发现只扫**一层**（`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`）；根目录 rank 100–600；旧键 `disableModelInvocation` 等出现即整条丢弃 |
| **运行时不管** | — | skill 的**目录名**、**SKILL.md 章节结构**、`references/`、`scripts/` 布局 |
| **门禁强制（非运行时）** | 官方 `scripts/verify-*.ts` | 笔记路径/文件头/章节/状态机、归档三元组与 manifest、链接、词数、换行 |
| **纯惯例** | 人 | 何时写 note、写哪一类、是否 supersede、README/AGENTS 是否同步 |

⇒ **普通项目最省力的做法：只承诺运行时强制的部分（它免费、且模型立即可见），门禁按需逐步引入。**

### 4.3 三个核心 skill 的适配成本（结论）

| Skill | 规模 | 结论 | 关键改动 |
|---|---|---|---|
| `dsh-archive-agent-notes` | 6.7 KB 单文件 | **小改即可用**，是三者中性价比最高 | 描述去仓名、相对路径、pnpm 命令、删交叉引用；保留「归档 vs 删除」判定与 5 步封印流程 |
| `dsh-doc` | 18.4 KB + 5 refs + 8 templates | 小改 + 局部重写 | 重建 kind→模板表；换全部 `pnpm run *`；删 Website 投影节；`doc-budgets.manifest.json` 换成自己的 |
| `dsh-code-review` | 12.1 KB | **重写但留骨架** | 换 Sources of truth、换 diff 命令、删 6 个交叉引用；**手工维度清单与缺陷四要素原样可用** |

其余 18 个 skill：读过全文的 5 个均为 DSH 生态专属（`dsh-pre-push-checks`、`dsh-translate-docs`、`dsh-trim-cot-leakage`、`dsh-find-simplifications`、`dsh-create-upgrade-guide`）或与其紧耦合，**普通项目不必搬**。`agent-experience`（2.1 KB，工具/skill 设计原则）是唯一**零改动**可用的通用件。

### 4.4 门禁脚本的可移植性（一句话版）

- **建议搬**：`verify-doc-budgets`（原样）、`verify-md-links` / `verify-md-wrap`（小改 + 2 个 helper）、笔记格式三门（小改）。
- **建议二期**：归档封印门（价值高但要 git + base ref + CRLF 纪律）。
- **别搬**：`install-lefthook.mjs`、`run-gates.ts`（6+ 仓库内模块聚合器）、两个 bash guard（`git ls-files :(icase,glob)` 等，Windows 不能原生跑）、双语配对门（5 模块，成本最高）、`.gitlab-ci.yml`（**只是 Python wheel 打包，与工程知识无关**）。
- **一个反直觉的提醒**：这些脚本是 **TypeScript + `tsx`**。普通项目引入它们 = 引入 node≥24.9 + tsx 工具链。如果只要 4 条不变量（4 行头、`Status:` 合法、日期格式、相对链接存在），**写 30–60 行纯 Node 反而更省**。见 §6 的裁决。

---

## 5. 自动化可行性分析（逐环节）

| 环节 | 官方已实现 | 只需配置 | 需要新增代码 | 诚实结论 |
|---|---|---|---|---|
| ① 经验发现 | ❌ | ⚠️ 部分 | ⚠️ 可选 | 无任何官方触发器。**零代码方案**：AGENTS.md 常设指令（「任务收尾若产生决策/踩坑/可复用流程，先写候选再报告」）。**纯自动方案**需插件订阅生命周期事件，见下方警告。 |
| ② 分类 | ⚠️ 只有六类目录约定 | ✅ | ❌ | 分类判据写进知识捕获 skill 的正文即可；格式可用门禁机械校验。 |
| ③ 候选文档 | ❌ | ✅ | ❌ | 直接写成 `proposed/<class>/YYYY-MM-DD-slug.md`（**用官方词汇，不要造 `draft/`**，否则后续无法复用官方门禁）。 |
| ④ 证据验证 | ⚠️ 只有形状门 | ✅ | ⚠️ 少量 | 格式/链接/词数可脚本化；**证据真伪（是不是幻觉）必须人看**。 |
| ⑤ 审核 | ❌（纯人工） | ✅ | ❌ | 人把 `proposed` → `implemented`（同次改写 `## Proposal` 为 `## Decision`）。**这是整套系统唯一不可省的闸门。** |
| ⑥ 正式发布 | ❌ | ✅ | ❌ | `git mv` + 改 Status 行 + commit。 |
| ⑦ 更新与归档 | ⚠️ 流程与封印脚本在 | ⚠️ | ⚠️ 二期 | 更新靠「同变更更新」，反转靠新 note；归档用官方封印脚本或人写 `Archived:` 行。 |

**钩子路径的具体代价（给「要不要写插件」的决策依据）**【已验证事件语义 + 推断风险】：

- `agent/pre-step` 是 waterfall 且被 `await`（`dsh-agent`）⇒ 每步都可能被你的沉淀逻辑拖慢。
- `agent/turn-stopping` 是 serial 且被 `await`（`dsh-agent-loop`）⇒ 最坏情况卡住回合收尾。
- **没有独立「会话结束」事件**，只有 `session/disposed`（此时模型已不可用）⇒ 「会话结束时总结」在架构上就是别扭的。
- 已有静默 LLM 先例（`session-title-first-prompt-llm` 每会话一次、`compaction-basic` 0.8 阈值摘要）⇒ **额外调用=额外计费**是可预期的，不是理论风险。
- Goal 自动续轮 + Team mailbox + schedule 三者都会让「沉淀动作」被再次触发 ⇒ **递归自触发**需要额外的幂等键。
- 压缩发生在沉淀之前（0.8 阈值、保留 16% 尾窗、工具结果 8192 字符截断）⇒ 你沉淀的是**摘要的摘要**，证据质量天然差。

⇒ **裁决：第一阶段不做任何钩子。** 若将来一定要做，唯一可接受形态：只在 `agent/turn-stopping`、显式 opt-in、只写 `proposed/`、单文件、幂等键、失败静默。

---

## 6. 推荐的最小实施方案

> 三阶段，**不给时间表**（用户要求）。每阶段都有「不做就停」的判据。

### 阶段 0 — 前置与最小可验证链路（半天内，零代码、零依赖）

**目标**：证明「文件放对位置 → DSH 自动看见」，并建立版本控制。

依赖：无（全部用 DSH 已装能力）。

动作：
1. `git init`（当前工作区不是 git 仓库，这是硬前置）+ `.gitattributes` 写 `* text=auto eol=lf`。
2. 根 `AGENTS.md` ≤1 页：只放 6–10 条铁律（如「决策理由写 `.agents/notes/`，程序写 `.agents/skills/`」「不得自批 `Status: implemented`」「改机制文件先问人」），每条 1–3 行。
3. `.agents/notes/README.md` 一页：从官方 `README.zh.md` 裁剪出「三类状态 + 何时写 + 命名 + 四段结构（Problem/Decision/Alternatives/Consequences）」，删掉双语/侧车/哈希/六类细节。
4. 建 `.agents/notes/proposed/`、`.agents/notes/implemented/`（`rejected/`、`archived/` 暂不建）。
5. 放一个探针 skill：`.agents/skills/knowledge-capture/SKILL.md`（frontmatter 只写 `name`+`description`，description 内含触发词如「bug 修复完成后 / 架构决策 / 反复出现的同类错误」）。

**验收标准**（都是可观察的，不需要读源码）：
- 新会话第一条请求里出现 `Instructions from: AGENTS.md` 段 ⇒ AGENTS.md 链生效。
- 下一回合 skill 目录里出现 `knowledge-capture` ⇒ 项目级 skill 发现生效。
- 故意把 skill 的 `name` 改成 `Bad_Name` ⇒ 目录里消失（证明运行时只认 kebab-case，且**静默**）。

**风险**：把知识塞进 AGENTS.md 会触发 65,536 B/链预算的静默丢弃；`.local.md` 不要提交；Windows 上别用 symlink 组织 skill。

### 阶段 1 — 候选—审核两段式 + 最小门禁（1–2 天，唯一需要写代码的阶段）

**目标**：让「沉淀」有产出口，让「污染」进不了正式区。

依赖：阶段 0。

动作：
1. 在根 `AGENTS.md` 加一条流程指令：任务收尾若满足任一条件（①产生了一个决策 ②修掉一个非平凡 bug ③同一类错误第二次出现 ④一套流程被验证可重复），**只写 `proposed/` 候选**并回报路径；禁止改 `implemented/`。
2. 写 `scripts/check-notes.mjs`（30–60 行纯 Node）：校验 4 行头、`Status:` ∈ {proposed, implemented, rejected: …}、路径↔状态一致、文件名 `YYYY-MM-DD-`、文中相对链接目标存在。
3. 从官方搬 **2 个** skill 并小改：`dsh-archive-agent-notes`（裁决判据）与 `dsh-code-review`（保留手工维度清单，换来源清单）。
4. 人工闸门写进 `README`：`proposed → implemented` 必须由人执行，且同次把 `## Proposal` 改成 `## Decision`。

**验收标准**：
- 故意写一个 `Status: accepted` 的 note ⇒ 门禁红，且报错信息指出具体行。
- 一次真实 bug 修复产出 1 个 `proposed/` 候选，人审后 `git mv` 进 `implemented/` 并通过门禁。
- 门禁**没有**误报已有合法文件（跑一遍存量）。

**风险**：门禁过严会让人绕过它（最常见失败模式是「把门禁注释掉」）⇒ 起步只上 5 条不变量，宁缺毋滥；**不要**在这一阶段引入 tsk/tsx 工具链。

### 阶段 2 — 按需要的生命周期自动化（触发条件明确后才启动）

**目标**：只解决真实出现的痛点，不预设。

启动判据（全部满足才做）：①`implemented/` > ~15 篇 ②已出现重复/矛盾实例 ≥2 次 ③有人抱怨「找不到/不知道哪条还有效」。

可选项（按性价比排序）：
1. **搬 `verify-doc-budgets`（原样）**：给根 `AGENTS.md` 设词数上限，一格 manifest，防膨胀最有效。
2. **巡检会话**：用官方 `schedule` 建一个每周/每月任务，投递到 `new_once` 会话，指令是「列出 90 天未触碰的 implemented note + 与现状矛盾的候选，**只出清单不改文件**」。注意：宿主必须在运行时投递，重启只补最近一次。
3. **归档封印**：搬归档门 + manifest（若历史价值高、需要防篡改）。
4. **明确不做**：逐回合/会话结束自动写正式文档；后台常驻蒸馏服务；向量库/embedding 去重；复杂元数据 schema；照抄双语配对与 `run-gates`。

**验收标准**：巡检只产出候选、不直接改文件；现有 Session 与 Agent Teams 行为无可观察变化（无额外等待、无重复写入）。

---

## 7. 风险及待验证问题

### 7.1 已确认的具体风险（按杀伤力排序）

| # | 风险 | 机制（证据） | 缓解 |
|---|---|---|---|
| 1 | **AGENTS.md 静默降级** | 预算 65,536 B/**链**；超限先丢宽泛文件、最后截断最具体文件；超预算文件在刷新期间「视为暂时不可用」 | 根 AGENTS.md 设词数上限；知识一律外置 |
| 2 | **CRLF 毁掉字节级门** | 官方用 `* text=auto eol=lf` 锁行尾；笔记格式门逐行比较、归档用 git blob + sha256 | 第一天就写 `.gitattributes`，并禁用 `core.autocrlf` 造成的落盘差异 |
| 3 | **Windows 上 symlink 退化** | `.claude/skills` 是 symlink；`agent-experience/SKILL.md` mode `120000` | 复制 skill 时拷真实文件；不要用 symlink 组织知识库 |
| 4 | **自动写入污染** | 压缩后上下文已损耗（0.8 阈值/16% 尾窗/8192 字符截断）⇒ 幻觉证据；同轮多写冲突；把内网端点/绝对路径写进 git | agent 只写 `proposed/`；`Status: implemented`、归档/删除/合并、批量多文件写一律人工；提交前扫敏感串 |
| 5 | **钩子阻塞与计费放大** | `pre-step` waterfall `await`；`turn-stopping` serial `await`；无会话结束事件 | 不写钩子；必须写时只挂 `turn-stopping` + opt-in + 幂等 |
| 6 | **Team 并发写** | 文件工具用版本守卫（`FS_STALE_VERSION`），**脚本写入不受保护**； Teams 任务板 `writeScopes` 只是告警 | 每个知识文件单一 owner；Lead 负责合并；不让多个 teammate 直写同一文件 |
| 7 | **官方 skill 描述带仓名导致路由错误** | description 是唯一路由依据（目录不渲染 `whenToUse`） | 移植时必须改 description，否则在别的项目里「该触发时不触发」 |
| 8 | **迁移到 Mac 的可移植性** | 本机工具面是 `pwsh`，Mac 是 `bash`；`Makefile` 在 Windows 无 make；两个 bash guard 不可移植 | 校验脚本只用 Node；不用 make；CI 上再补 bash 门 |

### 7.2 成员分歧与我（队长）的裁决

| 分歧点 | 各方说法 | 我的核实与裁决 |
|---|---|---|
| `CLAUDE.md` 的性质 | 反证组称「官方用 CLAUDE.md symlink AGENTS.md」 | **反证组记错**。GitHub contents API 显示 `CLAUDE.md` 是普通文件（type=file, 9 B），raw 抓取内容就是 `AGENTS.md` 一行；真正是 symlink 的是 `.claude/skills`（17 B → `../.agents/skills`）。**不影响其结论**，但报告里不能照抄这个细节。 |
| 层级加载「是否自动」 | 架构组标「自动加载未验证」 | **我用运行时代码/包文档补证**：`dsh-base` 默认挂载 + README 明确 65,536 B/链、候选、去重、嵌套注入。**结论：AGENTS.md 链与 `.agents/skills` 确实自动；`.agents/notes/**` 不自动**。 |
| 官方 note 精确篇数 | 架构组称「四生命周期齐全」；反证组只得到 `archived/architecture` ≥109 的下限 | **双方都无法给全量**（GitHub tree 响应超大，我的抓取也被 100 KB 截断，仅解析到 333 条路径）。**裁决：篇数不作为论据**，只用「规模量级 + 目录活跃」佐证；任何精确计数标【未验证】。 |
| 起步目录该用 `draft/` 还是官方 `proposed/` | 反证组建议 `draft/`（更防污染）；架构组建议官方四生命周期 | **采纳官方 `proposed/`**：整套方案的价值就是「原样复用」，自造目录名会让后续官方门禁、skill、文档全部对不上；防污染靠「人批准才 `git mv`」，与目录名无关。 |
| 门禁：搬官方 TS 脚本 vs 自写 30 行 Node | 契约组：官方脚本「小改即可用」；反证组：20 行 Node 够用 | **分阶段裁决**：阶段 1 自写纯 Node（不引入 tsx/node≥24.9 工具链）；阶段 2 若真的需要词数上限/归档封印，再原样搬 `verify-doc-budgets` 与归档门。两者不矛盾，是顺序问题。 |

### 7.3 待进一步验证（不要当结论用）

1. 全部官方脚本**未实跑**（出网 TLS 失败）：`verify-agent-note-format` 等是否在你的 Node/tsx 版本下开箱可跑，未验证。
2. `agent/turn-stopping` 在 aborted/error 回合是否仍派发（影响「失败回合污染」的严重度）。
3. `auto-review` 是否可被其他 preset 间接启用（当前 base/web/profile 三层 patch 均 0 命中该能力）。
4. Team + Goal 组合下，若强行加沉淀动作，实际额外 LLM 调用次数（需实测，会花钱）。
5. macOS 沙箱对 `.agents/notes/` 写入策略、APFS 大小写严格性对「封闭集合」校验的影响。
6. `dsh-doc` 8 个 template 与 `docs/i18n/README.md` 的具体内容（未逐字读）。

---

## 8. 最终决策建议

**① 是否值得建设？**
值得，但**按「规则 + 格式 + 两段式流程」建**，不按「自动记忆系统」建。收益来源不是自动化，而是：常驻规则让 agent 少犯重复错误、候选审阅让人保留判断权、目录纪律让知识不腐烂。若你的目标是「完全无人值守地自动积累知识」，那**不值得**——官方没有这个能力，自研会踩阻塞、计费、递归、污染四个坑。

**② 官方体系能复用到什么程度？**
- 运行时能力：**100% 复用，零开发**（AGENTS.md 链、`.agents/skills`、skill 目录渐进披露、FTS5 会话检索、schedule、Teams）。
- 结构与规则文字：**100% 可照抄**（tier taxonomy 表、slop checklist、note 生命周期与四段结构、postmortem 模板）。
- Skills：21 个里 **1 个原样**（`agent-experience`）、**2 个小改**（`dsh-archive-agent-notes`、`dsh-doc`）、**1 个重写留骨架**（`dsh-code-review`）、其余不必搬。
- 门禁脚本：**约 4 个可小改搬用**（笔记格式、链接、换行、词数），其余（双语配对、归档聚合器、bash guard、`run-gates`、`install-lefthook`）**不复用**。
- 不可复用的本质：这一切是**贡献者纪律**，其有效性来自「评审 + 预算 + 冻结」，而不是来自代码。

**③ 是否需要第三方插件？**
**不需要。** 现装的 `dsh-agent-team-presets` 与本需求无关（它是 Team 侧预设）；`dsh-context` 也不必为知识管理引入。任何「记忆插件」都会与已内置的 AGENTS.md 链/skill/会话检索重叠，且引入版本兼容与计费的不确定性。

**④ 最少需要自研什么？**
四项，全部很小：
1. 根 `AGENTS.md` 内容（人写，≤1 页）；
2. `.agents/notes/README.md` 一页规则（从官方裁剪）；
3. 一个 `knowledge-capture` skill（~1 页，description 带触发词）；
4. 一个 30–60 行纯 Node 格式校验脚本（阶段 1）。
无一需要插件、服务、数据库、后台进程。

**⑤ 下一步应该先做哪一个最小可验证动作？**
**「三文件探针」**：在真实项目里 `git init` → 写根 `AGENTS.md` → 建 `.agents/skills/knowledge-capture/SKILL.md`，然后**开一个新会话**，确认两件事：新会话首条请求出现 `Instructions from: AGENTS.md`；skill 目录中出现 `knowledge-capture`。
约 15 分钟，零风险、可回滚，且**一次性验证整条自动发现链路**（这是所有后续设计的地基）。验证不过，就不值得继续投入。

**需要你决定的事项**（本轮只读，均未执行）：
- 是否在 `H:\Dev\dsh-lab` 执行 `git init`（当前不是 git 仓库），还是在某个真实项目里先试点；
- 知识库是「每个项目一份 `.agents/`」还是「一个共享库 + 项目内只放指针」（影响多设备/多 agent 复用形态）；
- 是否采用官方六类目录（起步用三目录更好，但六类换取官方门禁兼容）；
- 是否需要中英双语（建议先不做，这是官方成本最高的一环）；
- 是否要 `schedule` 定期巡检（会引入「宿主必须运行」的运维前提）。

---

## 附：证据索引

- 官方文档：`docs/AGENTS.md`（分层与写作标准）、`docs/agent-lifecycle.zh.md`（生命周期事件）、`.agents/notes/README.md`（笔记生命周期）、`docs/postmortem/README.md`、`docs/defensive-patterns/README.md`
  → https://github.com/deepseek-ai/deepseek-harness/tree/master/docs
- 官方 skills：https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills
- 本机运行时包文档（绝对路径，均在 `…\@deepseek-ai\dsh\node_modules\@deepseek-ai\` 下）：`dsh-agent-instructions/README.zh.md`、`dsh-skill-filesystem/README.zh.md`、`dsh-tool-skill/README.zh.md`、`dsh-experimental-agent-team/README.zh.md`、`dsh-schedule/README.zh.md`、`dsh-harness-dev-context/README.zh.md`
- 本机默认挂载：`dsh-base/cordis.patch.yml:307-319`；本 profile bundles：`C:\Users\auflu\.dsh\profiles\web\package.json`
- 成员详细笔记：[system-architect](tmp/scratch/system-architect/findings.md)、[contract-designer](tmp/scratch/contract-designer/findings.md)、[plan-reviewer](tmp/scratch/plan-reviewer/findings.md)
