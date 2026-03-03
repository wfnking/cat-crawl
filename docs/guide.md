## 目标

生成一个可以通过飞书远程调用本地电脑，把微信公众号文章保存到自己的 obsidian 资源库的后台应用。


## 用到的技术栈

- Nodejs
- Langchain.js
- Playwright
- Obsidian CLI

## 功能流程

1. Node 常驻应用启动后，通过飞书长连接持续接收消息（不单独暴露业务 HTTP 接口）。
2. Node 创建后台任务，提取消息内容并转发给 LangChain。
3. LangChain 判断消息是否包含“微信公众号文章链接”。
4. 若是公众号链接：
- LangChain 自动调用 `crawl_wechat_article` 工具。
- 该工具内部调用 Playwright 抓取文章内容。
- 抓取完成后，LangChain 调用 `save_to_obsidian` 工具，通过 Obsidian CLI 保存为 Markdown 文件。
- 保存成功后返回成功结果（附带 Obsidian 文件路径）。
5. 若不是公众号链接：
- 直接返回“暂不支持该类型消息”的友好提示。

## 开发阶段

### 阶段 1（当前先做）

- 搭建 TypeScript 工程架构。
- 用 LangChain Tool 跑通 `crawl_wechat_article` + `save_to_obsidian`。
- 使用 DeepSeek API 驱动 Agent。
- 先在本地输入文本验证抓取与保存链路。

### 阶段 2

- 接入飞书消息通道。
- 把飞书消息接入阶段 1 的处理链路并回传结果。
