## 开发计划

### 阶段 1（先跑通核心链路）

1. 搭建 TypeScript 架构
- 初始化 Node + TypeScript 项目结构（`src/`、配置、启动脚本）。
- 建立模块边界：`agent`、`tools`、`services`、`config`。

2. 实现 LangChain 调用工具
- 用 LangChain Agent + Tools 模式。
- 最小只暴露两个工具：`crawl_wechat_article`、`save_to_obsidian`。
- 规则：非公众号链接直接返回友好提示。

3. 使用 DeepSeek API
- 通过 OpenAI 兼容接口接入 DeepSeek。
- 模型参数通过环境变量配置（默认 `deepseek-chat`）。

4. 使用 Obsidian CLI 存入笔记
- 新建 `save_to_obsidian` 工具，调用 `obsidian create/append`。
- 返回保存路径，作为最终结果的一部分。

### 阶段 2（渠道接入）

1. 飞书接入
- 接入飞书消息入口（长连接模式优先）。
- 把飞书文本消息转给阶段 1 的 Agent 处理。
- 将处理结果回发飞书。

### 阶段验收

- 阶段 1：
  - 本地输入公众号链接可触发工具链：抓取 -> 保存 Obsidian。
  - 非公众号链接返回“暂不支持”的友好提示。
- 阶段 2：
  - 飞书真实消息可触发同一条处理链路并收到回复。

### 暂不做

- 多平台链接支持（知乎、掘金等）
- 队列、重试、限流
- 完整监控与告警
