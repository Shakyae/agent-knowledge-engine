---
name: knowledge-ops
description: 在实现、架构、排障、部署、风险变更前检索工程知识，任务后沉淀候选，并触发审核与发布流程时使用。
---

# Knowledge operations

## 任务前检索
- 面对实现、架构、排障、测试、部署或风险变更，先按模块/技术、症状、操作构造具体关键词，执行 `node .pko/tools/scripts/kno.mjs search <terms>`。
- 搜索默认覆盖四类知识根：Agent Notes、Defensive Patterns、Postmortems、Cookbooks；需要时使用 `--include-candidates`，并可用 `--type`/`--limit` 缩小结果。
- 命中后只读查看相关文档；判断其 scope、status、verified、证据和当前代码是否仍适用，不把命中视为自动指令。
- 在任务摘要中说明检索词、采用的知识及适用性判断；没有命中也只表示“未找到”，不表示知识不存在。

## 任务后沉淀
- 仅在经验有可复用价值且有证据时沉淀；先检索候选与正式知识，找到权威归属后更新/链接既有文档，避免重复事实；再没有归属才新建候选。
- 候选必须包含可追溯证据、适用范围（scope）及验证条件；运行 `node .pko/tools/scripts/kno.mjs candidate new ...`，随后 submit。

## 独立审核
- 作者不得自审；审核者核对证据、范围、反例、重复与验证条件，并运行 `node .pko/tools/scripts/kno.mjs candidate check <id>`。
- Agent Teams 中由未参与候选生成的成员审核；Single-Session 中交由人工审核，不得把同一代理自称身份当作独立性证明。

## 集中发布
- 项目指定单一发布者；只有人工明确授权后才执行 approve 与 `node .pko/tools/scripts/kno.mjs publish <id>`，发布前检查 diff 和审计记录。
- 门禁发现候选内容、目标或目标文件自审核后发生漂移时必须拒绝发布，重新审核；不得绕过或自动重试。

## 边界
Skill/AGENTS 是软约束；普通文件/ shell 工具可绕过，身份无法验证，也不是安全隔离或访问控制边界。CLI 仅对经其处理的操作执行校验，不能证明审核者/授权者真实或独立。
