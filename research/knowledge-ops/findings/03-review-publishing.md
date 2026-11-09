# 独立反向审查：知识候选、审核与发布

## 结论与范围

**不能把 prompt、Skill、Team 角色分工或单次文件 CAS 当作强制的独立审核与发布权限。** 当前证据支持做“有人工授权的候选/审核流程”设计，不支持声称已实现不可绕过的自动发布。未拿到完整待审方案，以下是条件性风险和最小契约，非对某具体实现的冲突判定。仅查阅文件和官方资料，未做运行实验。

资料版本不同：本机安装 DSH 0.2.2-rc.1（[package.json](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json#L1-L11)），GitHub master 文档为在线现状，未核实其 commit 与安装包一致。现有可见 skill 主要是通用操作和插件排障，不能据此断言本机全部 provider 或市场没有相关 skill。

## 已核实的分类和生命周期

- 官方 [Agent Notes](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/README.md) 为决策/提案及取舍，路径是 lifecycle/class/date；class 为 feature、bug-fix、simplification、architecture、process、testing。proposed 未实现；implemented 跟踪已交付事实；rejected 只保留有价值原因；只有符合条件的 implemented 才进 archived。归档 triplet 冻结、不作为当前行为权威；仅适用严格条件才能合并删除。**不要把这套生命周期泛化为所有知识类型的统一状态机。**
- [Defensive patterns](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/defensive-patterns/README.md) 是审查规则及其适用边界；[cookbook](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cookbook) 是操作指南目录，[postmortem](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/postmortem) 是事故复盘目录；[AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md) 是常驻规则入口。具体项目是否采用同样布局需确认，不可把此处目录当成本项目已存在的规则。
- 本机 [agent-experience](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/agent-experience/SKILL.md#L3-L11) 强调最小上下文与按需加载；[插件排障 skill](/Users/shakya/.dsh/skills/agent-team-presets-troubleshooting/SKILL.md#L15-L35) 要求按运行证据、配置、展示值排序并区分自身与宿主问题。它们是操作指导，不提供知识发布授权机制。
- 安装包 [skill registry](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill/README.md#L48-L66) 根据名字归并；[限制](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill/README.md#L135-L140) 表明同名遮蔽且无 API 查看全部被遮蔽定义；[filesystem provider](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/README.md#L34-L56) 扫描多根、每次加载读当前正文。[实现](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js#L723-L735) 可直接读取解析后的路径。这是 skill 名字解析，不是跨知识库语义去重或内容审核。

## 关键风险与最小修正

1. **已验证的权限边界不足**：本会话 workspace-write 可以写工作区，且 [sandbox 文档](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-sandbox/README.md#L50-L59) 描述的是文件访问范围，不是按知识状态、作者或审核者授权。**推论**：若正式库与候选都在同一可写范围，限制某个发布工具或要求角色自律不阻止其他可写工具直接修改。自动发布需要部署层隔离：候选/审核者无正式库写权限，独立发布主体独占正式写权限，所有可用文件、shell、Git、插件及外部写入口均纳入威胁模型；管理员/人为直接写入是否例外须明确。若无法保证，降级为人工审核和人工授权发布，不宣称强制。
2. **独立性不能靠角色名称证明**：两个 agent 或不同会话不等于独立身份或独立控制；相同发起者、共享上下文和共同凭据都可能造成自审。建议至少保存不可由候选作者伪造的审核主体、候选内容 hash、版本、结论和证据；发布端校验审核者不等于作者，且审核主体有资格、审核版本仍有效。真正组织/人类独立性、凭据签发与撤销均待定义；模型复核只是第二意见，不等价于人审。
3. **去重不能等同相同文件名/向量阈值**：候选需记录来源、类型、范围、版本、主题和权威归属；先做可重复的规范化精确去重与来源事件幂等，再检索现有正式/候选/已拒绝项目提供相似候选，由审核者判断重复、补充、冲突、独立项；不自动覆盖或吞掉不同适用条件。索引不完整、扫描失败、权限缺失、skill 多根遮蔽时标记未知并阻止自动判定“无重复”，而不是默认为不存在。
4. **审核到提交之间 TOCTOU**：要求审核绑定候选不可变内容、目标路径及目标旧版本/树版本、授权策略版本和处理方式；修改任何一项使审核失效。发布前在同一事务或单写入者锁中重新核验去重、审核、授权、目标版本及状态。检测冲突即退出并重新审核，不静默重试覆盖。幂等键绑定候选版本及操作，失败和未知提交结果必须可查询/恢复。
5. **单文件原子性不等于业务事务**：本机 [fs-local](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-fs-local/lib/index.js#L917-L944) 按目标锁并原子写；[条件校验](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-fs-local/lib/index.js#L1019-L1032) 有版本/新建保护。它不证明多进程、shell/Git 外部写入、多个文件和审核账本之间具有原子一致性；官方 Agent Note 归档涉及英文/中文/sidecar triplet、链接修复与冻结，单文件 rename 尤其不够。推荐正式发布以受保护版本控制提交或受控发布服务为原子单位；账本与产物采用可恢复状态机及幂等提交，明确崩溃后 reconciliation，不声称天然 exactly-once。
6. **现有 skill 更新不等于可安全自动生效**：[filesystem provider](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/README.md#L79-L85) 监视变更，[正文无版本协议](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/README.md#L145-L152)，旧上下文可保留旧 body。若知识发布涉及 skill，需考虑实时生效、同名不同根遮蔽、引用资源未更新；审核覆盖完整 bundle、目标路径和版本，而不只 SKILL.md；必要时隔离发布根并对激活/回滚另行授权。

## 建议的最小落地路径（设计，未验证）

- 默认仅采集候选与生成建议；既有正式知识的升级、归档、删除必须有明确授权，遵守项目上位规则，不因自动化默认授权。
- 流转可采用 draft → submitted → independently-reviewed → authorized → published；退回、拒绝、失效为显式分支。每次修改产生新 revision，复审后才可发布。此状态机仅用于候选治理，**不替代** Agent Note 自身的 proposed/implemented/rejected/archived。
- 发布服务同时验证：可信主体权限、独立审查、绑定 hash、目标类别/路径白名单、预期旧版本、相似候选处置、授权范围和未过期策略；任何验证缺失、观察不完整、状态冲突或重放均 fail closed。日志记录来源、决策、执行者、版本、结果和恢复信息，注意脱敏。
- 验收应覆盖：作者自审、伪造审核、修改后复用审核、跨工具绕过、同源重放、两个并发相似候选、外部写入、崩溃与重复提交、检索不完整、归档冻结、symlink/路径逃逸、回滚权限；这些是未来测试计划，不是已做实验。
