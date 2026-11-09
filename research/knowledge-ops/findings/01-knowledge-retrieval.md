# 知识检索：只读研究

## 范围与结论

研究范围为 /Users/shakya/dev/dsh-lab 与 /opt/homebrew/lib/node_modules/@deepseek-ai/dsh 的当前可见文件。初次按精确文件名 glob 未发现旧报告；用户随后提供带版本号的 [旧报告](<../REPORT-knowledge-ops-v1.0.md>)，因此初次搜索遗漏了它。未运行实验，安装 profile 是否实际启用各组件也未验证。已安装包的 lib 是编译后 JavaScript；下文引用可实际读取的文件，不假定 TypeScript 源文件随包存在。

## 已核对事实

### AGENTS 分层与上下文

- [指令加载包](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-instructions/README.zh.md#L28-L42>)：全局 DSH home、共享 agents home，随后项目根至 cwd，顺序从宽泛到具体；默认基础候选 AGENTS.md、CLAUDE.md 和 local overlay。加载需插件及文件系统提供方。
- [指令预算及刷新](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-instructions/README.zh.md#L72-L76>)：全局链和项目链分别有 maxBytes 限制，优先保留具体文件；较宽泛内容可能被省略。相同配置下不应假定所有规则始终在上下文中。
- [生命周期](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-instructions/README.zh.md#L90-L109>)：指令作为可回放、可压缩的持久消息；成功的结构化 read/write/edit touch 驱动更深目录发现，路径和 digest 未变不重复注入。 [限制](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-instructions/README.zh.md#L219-L228>)：无持续 watcher，shell 导航不触发发现；符号链接可能引入树外内容。

### Skills 发现

- [格式和根目录](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/README.zh.md#L28-L56>)：只发现根目录直属 name/SKILL.md 或 name.md；frontmatter 含 name、description，目录摘要与正文按需加载分离。默认根 rank 从项目 DSH、项目 agents、自定义、用户 DSH、用户 agents 到可配置 bundled；项目根为最近 .git 祖先，否则 cwd。不同提供方还可能存在，不应将此视作全部 skill 来源。
- [实际发现代码](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js#L595-L625>)遍历根直属条目；[监视过滤](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js#L555-L570>)明确识别的层级。与 AGENTS 不同，skill 根默认有 watcher；[刷新、错误与限制](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/README.zh.md#L79-L85>)及[遗漏场景](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/README.zh.md#L145-L152>)说明无效条目、不可读根、正文旧历史等风险。

### 搜索与分散检索

- [glob 构造](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js#L539-L555>)与[参数](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js#L573-L605>)：搜索隐藏和忽略文件，但排除 VCS 元数据；结果按修改时间排序，超限时[按顶层分组抽样](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js#L637-L650>)，不可把显示页当成全量。
- [grep 实现](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js#L879-L900>)用打包 ripgrep；[参数构造](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js#L935-L950>)没有 glob 的 --hidden、--no-ignore，所以两种搜索范围可能不同。默认匹配上限 250、单行预览 2000 字节；应 read 原文上下文，不以命中行代替证据。
- [会话检索](</opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-session-query/lib/index.js#L930-L969>)限调用者工作区，session_search 返回每个会话最强匹配，默认最多 100 条且有 30 秒合作式超时；命中后通过 trace/read 核实关系和全文，不是全量知识库。

## 推断、成本与建议

- **推断**：把普遍适用、短小的规则放 AGENTS，细节通过链接按任务读取；把可复用任务流程放 skill。避免多个地方重复维护同一事实，减少漂移及无关上下文。
- **推荐检索路径**：先 glob 找候选路径，再按目录或文件类型 grep，read 相关段落和相邻上下文；需要解释历史时补充 session_search、event_read/trace。对隐藏、忽略文件或超限场景分区复查，并明确未覆盖范围。
- **成本与风险**：分散检索增加工具调用和上下文 token，减少一次性注入无关内容；目录/正文分离降低常驻负担但增加按需读取。宽泛指令可能被预算淘汰，误把搜索摘要当全文、将仓库指令当高优先级命令、或跟随不可信链接均有风险。可使用范围限定、原文复核和文件系统策略降低风险。
- **未实测**：实际启用配置、特定项目的全部规则链、检索召回率、真实耗时/token、缓存命中率及 watcher 行为；上述成本是定性分析，不是测量结果。
