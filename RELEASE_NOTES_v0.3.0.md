## 中文

### 新增
- 用户级 AKE Skill 更新器仅支持三种拓扑：仅 canonical 用户安装、canonical + Claude Code 链接、canonical + Claude Code + CodeBuddy 链接；不表示支持 Codex 安装组合，也不表示支持其他 Agent 组合。
- Preflight 独立报告 Skill bundle、随附用户 CLI、项目 CLI 自报值和项目配置版本；检测到用户 CLI 较新时提供非阻塞升级审阅建议。旧版项目 CLI 缺少自报版本时显示未知，不以配置版本代替。

### 优化
- 安装开始前核对安装身份、链接、lock 和备份；扩展对相关 Agent 路径覆盖环境变量的拒绝策略，并检查更新期间的漂移。
- 明确区分 Skill 更新与目标项目 CLI/config 升级。审阅项目升级方案不会自动改写项目文件；需要先备份、比较具体差异、呈现写入和恢复计划，并另行获得对实际写入的明确授权。项目配置、CLI 与知识数据须人工审阅和维护。

### 重要说明
- v0.2.1 旧版 Skill bundle 不会自动获得 v0.3.0 的新拓扑识别能力，也不得假定旧版 updater 能安全更新这些新拓扑。使用新能力前，应由操作者先审查并备份现有安装；可按 README 官方方法通过完整 commit SHA 安装新 Skill（`npx skills add Shakyae/agent-knowledge-engine@<full-commit-sha> --skill ake -g`）。此第三方安装命令不执行 AKE updater 的身份识别、定制检测或备份门禁，因此安装前的审查备份由操作者负责。另一选择是仅在符合 README 约束时，从官方源码 checkout 发起 AKE updater 更新（官方 origin，且 `skills/ake` 未修改）；该 updater 执行其自身适用的身份、定制检测和备份流程。不得假定旧版 updater 支持新拓扑或借其绕过这些限制。支持范围严格限于：仅 canonical 用户安装、canonical + Claude Code 链接、canonical + Claude Code + CodeBuddy 链接。其他拓扑（包括 CodeBuddy-only）拒绝自动更新并须人工检查。更新不会自动升级目标项目中的 `.ake/tools` 或配置。
- 更新过程的安装替换不是原子事务。若安装器可能已启动后失败或结果不确定，AKE 不会自动回滚或清理备份；停止其他 AKE 写入者，保留现场和备份，核对备份 manifest 与 data，并检查当前 canonical 安装树、所有 Agent 链接及 lock 文件；先另存当前状态，再人工决定如何恢复。不得盲目覆盖或重试。
- 版本提示、审阅选择和确认路径是 Agent 流程指引，不是宿主强制的安全边界。Preflight 会执行既有项目 CLI 的 status；不能保证该命令无副作用。
- 验证限制：更新的主要自动化失败路径使用隔离环境和模拟安装器；本版本记录的真实 Skills CLI/远端观察限 macOS。Windows ACL、Linux、网络文件系统、真实安装失败后的人工恢复、进程崩溃恢复及真实 DSH 重载均未由所记录验证证明。参阅 `docs/test-report.md` 的逐项覆盖和历史证据。

## English

### Added
- The user-level AKE Skill updater supports exactly three topologies: the canonical user installation alone, canonical plus a Claude Code link, and canonical plus Claude Code and CodeBuddy links. This does not claim support for Codex or any other Agent combination.
- Preflight reports the Skill bundle version, bundled user CLI version, project CLI self-reported version, and project configuration version independently. A newer user CLI produces a non-blocking upgrade-review advisory. A legacy project CLI without a self-reported version is reported as unknown; the configuration version is not used as a substitute.

### Improved
- Before installation, the updater checks installation identity, links, the lock file, and the backup, rejects relevant Agent-path override environment variables, and checks for drift during the update.
- Skill updates are explicitly distinguished from upgrades of a target project's CLI/configuration. Reviewing a project upgrade plan does not automatically rewrite project files: back up first, compare concrete differences, present the proposed writes and recovery steps, and obtain separate explicit authorization for the actual writes. Project configuration, CLI, and knowledge data remain subject to manual review and maintenance.

### Important Notes
- The v0.2.1 Skill bundle does not automatically gain v0.3.0 topology-detection capability; do not assume its updater can safely update these new topologies. Before using the new capability, the operator should review and back up the existing installation. The new Skill may be installed by the official README method using a full commit SHA (`npx skills add Shakyae/agent-knowledge-engine@<full-commit-sha> --skill ake -g`). This third-party installer does not run the AKE updater's identity, customization-detection, or backup gates, so the operator is responsible for review and backup before installation. Alternatively, the AKE updater may be initiated from an official source checkout only when it meets the README constraints (official origin and unmodified `skills/ake`); that updater runs its own applicable identity, customization-detection, and backup process. Do not assume the old updater supports new topologies or use it to bypass these limits. The supported scope is exactly: canonical user installation alone; canonical plus a Claude Code link; canonical plus Claude Code and CodeBuddy links. Other topologies, including CodeBuddy-only, are refused for automatic update and require manual inspection. The updater does not automatically upgrade `.ake/tools` or configuration in target projects.
- Installation replacement is not an atomic transaction. If the installer may have started and then fails or its result is uncertain, AKE does not automatically roll back or clean up the backup. Stop other AKE writers, retain the live state and backup, inspect the backup manifest and data, and inspect the current canonical installation tree, all Agent links, and the lock file. Save a separate copy of the current state before deciding manually how to recover. Do not blindly overwrite or retry.
- Version advisories, review choices, and confirmation steps are Agent workflow guidance, not host-enforced security boundaries. Preflight executes the existing project CLI's status command; side effects from that command cannot be ruled out.
- Verification limits: the main automated update-failure paths use isolated environments and a simulated installer; the recorded real Skills CLI/remote observations for this release are limited to macOS. The recorded evidence does not establish Windows ACL correctness, Linux or network-filesystem behavior, manual recovery after a real installation failure, process-crash recovery, or a real DSH reload. See `docs/test-report.md` for coverage and historical evidence.
