## 中文

### 变更
- 项目操作统一使用随 AKE Skill 分发的共享 CLI，并通过 `--project <absolute-target>` 选择目标数据；初始化不再创建项目内 CLI。
- 既有 `.ake/tools/` 文件作为遗留数据保留，不读取、不执行、不复制覆盖、不自动升级。需要迁移的外部脚本由操作者审阅后改用共享 CLI。
- 同步 Skill 安装与项目初始化说明，明确仅需安装/更新共享 Skill，不存在逐项目 CLI 升级路径。

### 兼容性与边界
- `.ake/config.json` 的现有格式版本（`0.1.0`）、知识文档格式与候选/发布门禁均未改变；Skill bundle 与共享 CLI 的 `0.4.0` 是独立的运行版本声明。
- 版本更新不会迁移、修改或删除已有项目配置、知识数据或 `.ake/tools/` 遗留文件。
- C-0004（retrieve/capture/review/publish 流程）与 C-0005（共享 AKE 操作安装/使用）经独立审查并在用户明确授权后批准、发布，已同步到正式 Cookbook，取代旧 `.ake/tools/scripts/ake.mjs` 指令。C-0004 与 C-0005 的审查标签均为 PASS WITH LIMITATIONS（C-0004 的 CLI verdict 为 `approve`）。两份文档仍标记 `verified: pending`：静态 Skill/源码与列明的已有集成测试仅支持各自覆盖的路径；候选审查未验证真实第三方 Skill 分发/安装、DSH 宿主加载、真实用户同意交互/宿主遵循；C-0005 另未验证真实并发更新中的独立进程行为。这些限制仅适用于未覆盖的外部路径，不否定已引用测试路径的证据，也不要求所有流程步骤都进行实测。
- 安装需使用官方仓库的完整 commit SHA；第三方 Skills CLI 的安装行为与 AKE 自身更新器门禁不同，安装前应审阅并备份现有定制。详见 README 的安装与迁移说明。

## English

### Changed
- Project operations use the shared CLI distributed with the AKE Skill, with `--project <absolute-target>` selecting project data; initialization no longer creates a project-local CLI.
- Existing `.ake/tools/` files are retained as legacy data: they are not read, executed, copied over, or automatically upgraded. Operators must review and migrate any external scripts to the shared CLI.
- Skill installation and project initialization guidance now describe a single shared Skill install/update path; there is no per-project CLI upgrade path.

### Compatibility and boundaries
- The existing `.ake/config.json` format version (`0.1.0`), knowledge document formats, candidate lifecycle, and publish gate are unchanged. `0.4.0` is the independent runtime version declaration for the Skill bundle and shared CLI.
- This version update does not migrate, modify, or delete existing project configuration, knowledge data, or legacy `.ake/tools/` files.
- C-0004 (the retrieve/capture/review/publish workflow) and C-0005 (installing/using shared AKE operations) passed independent review and were approved and published after explicit user authorization; the updates are now in the formal Cookbooks, replacing legacy `.ake/tools/scripts/ake.mjs` instructions. Both C-0004 and C-0005 received PASS WITH LIMITATIONS review labels (C-0004's CLI verdict was `approve`). Both documents retain `verified: pending`: static Skill/source material and the cited existing integration tests support only their covered paths. The candidate reviews did not verify real third-party Skill distribution/installation, DSH host loading, live user-consent interaction or host adherence; C-0005 also lacks evidence for independent-process behavior during a real concurrent update. These limits apply to the uncovered external paths; they do not negate evidence for cited/tested paths or imply that every workflow step requires live testing.
- Install from the official repository using a full commit SHA. The third-party Skills CLI does not provide the same gates as AKE's own updater; review and back up existing customizations before installation. See the README installation and migration instructions.
