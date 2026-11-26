## 中文

### 变更
- 项目操作统一使用随 AKE Skill 分发的共享 CLI，并通过 `--project <absolute-target>` 选择目标数据；初始化不再创建项目内 CLI。
- 既有 `.ake/tools/` 文件作为遗留数据保留，不读取、不执行、不复制覆盖、不自动升级。需要迁移的外部脚本由操作者审阅后改用共享 CLI。
- 同步 Skill 安装与项目初始化说明，明确仅需安装/更新共享 Skill，不存在逐项目 CLI 升级路径。

### 兼容性与边界
- `.ake/config.json` 的现有格式版本（`0.1.0`）、知识文档格式与候选/发布门禁均未改变；Skill bundle 与共享 CLI 的 `0.4.0` 是独立的运行版本声明。
- 版本更新不会迁移、修改或删除已有项目配置、知识数据或 `.ake/tools/` 遗留文件。
- 当前正式 Cookbook 文档仍含指向项目 `.ake/tools/scripts/ake.mjs` 的旧指令，不应执行。替代修订仍只存在于候选门禁中：C-0004 独立审查标签为 PASS WITH LIMITATIONS（CLI verdict `approve`，此为 review verdict 而非候选批准）；其 `verified: pending`，未验证真实 Skill 安装或宿主加载。C-0005 第二轮审查为 BLOCK。两候选均未获批准、未发布，正式文档尚未同步。
- 安装需使用官方仓库的完整 commit SHA；第三方 Skills CLI 的安装行为与 AKE 自身更新器门禁不同，安装前应审阅并备份现有定制。详见 README 的安装与迁移说明。

## English

### Changed
- Project operations use the shared CLI distributed with the AKE Skill, with `--project <absolute-target>` selecting project data; initialization no longer creates a project-local CLI.
- Existing `.ake/tools/` files are retained as legacy data: they are not read, executed, copied over, or automatically upgraded. Operators must review and migrate any external scripts to the shared CLI.
- Skill installation and project initialization guidance now describe a single shared Skill install/update path; there is no per-project CLI upgrade path.

### Compatibility and boundaries
- The existing `.ake/config.json` format version (`0.1.0`), knowledge document formats, candidate lifecycle, and publish gate are unchanged. `0.4.0` is the independent runtime version declaration for the Skill bundle and shared CLI.
- This version update does not migrate, modify, or delete existing project configuration, knowledge data, or legacy `.ake/tools/` files.
- The current formal Cookbook documents still contain legacy instructions invoking project `.ake/tools/scripts/ake.mjs`; do not execute those instructions. Replacement updates exist only behind the candidate gate: C-0004 received PASS WITH LIMITATIONS (CLI verdict `approve` as the review verdict, not candidate approval); its metadata remains `verified: pending`, and no real Skill installation or host loading has been verified. C-0005 received BLOCK in its second review. Neither candidate has been approved or published, so the formal documents have not been synchronized.
- Install from the official repository using a full commit SHA. The third-party Skills CLI does not provide the same gates as AKE's own updater; review and back up existing customizations before installation. See the README installation and migration instructions.
