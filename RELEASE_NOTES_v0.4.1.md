## 中文

### 优化
- 新增 `/ake harvest` Skill 提示路由，用于评估当前 Session 可见内容、查重正式知识与候选，并整理、检查及请求独立审核符合条件的候选；该入口不会自动发布。
- 审核指南进一步明确证据适用范围、待验证状态与高风险安全要求的判定；要求对修改请求给出可定位的问题和具体修订方向。
- AKE Skill 更新备份改为按旧安装版本命名并追加保留；不再自动清理或迁移旧备份，且拒绝不安全的备份目录。

### 重要说明
- `/ake harvest` 是 Skill 提示路由，不保证宿主自动加载或执行该流程；真实 DSH 环境验证待完成。候选审核仍遵循现有流程，且此入口不代替发布授权。
- 旧备份目录保持不变；新备份保留在 `~/.agents/skills-backups/ake/` 下。操作者应在检查内容及当前安装状态后再决定是否手动清理。
- 审核指南变更明确了提示规则与 CLI verdict 的对应关系；测试中的审核案例是合成契约向量，不代表执行过真实审核。

## English

### Improved
- The new `/ake harvest` Skill prompt route assesses visible session content, checks for existing formal knowledge and candidates, and can prepare, check, and request independent review for eligible candidates; it does not publish automatically.
- Reviewer guidance now clarifies evidence scope, pending verification, and critical safety requirements, and requires actionable, traceable details for change requests.
- AKE Skill update backups are named using the prior installed version and retained append-only; updates no longer prune or migrate old backups and reject unsafe backup directories.

### Important Notes
- `/ake harvest` is a Skill prompt route, not a guarantee that the host will load or run the workflow; validation in a real DSH environment remains pending. Candidate review follows the existing process, and this route does not replace publication authorization.
- Existing backup directories are left unchanged. New backups are stored under `~/.agents/skills-backups/ake/`; operators should review their contents and the current installation before deciding whether to remove them manually.
- The review-guidance change clarifies how prompt labels map to CLI verdicts. Review cases in tests are synthetic contract vectors and do not represent actual reviews.
