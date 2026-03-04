# 用飞书机器人一键保存公众号文章到 Obsidian，我做了个小工具

最近我把知识管理主阵地放在 Obsidian。  
问题是：公众号文章经常在手机上刷到，想收进知识库却很麻烦，复制、清洗、建笔记、分类一套下来很打断体验。

于是我做了一个小项目 `cat-crawl`：  
在飞书里给机器人发公众号链接，它会自动抓取正文、转 Markdown、分类目录，然后写入 Obsidian。

项目地址：<https://github.com/wfnking/cat-crawl>

## 这工具能做什么

- 输入公众号链接（`mp.weixin.qq.com`）
- 自动抓取文章正文
- HTML 转 Markdown，尽量保留结构和图片链接
- 基于内容做 `dynamic_folder` 分类（可配置候选目录）
- 通过 Obsidian CLI 保存到指定 Vault
- 支持飞书机器人长连接（WebSocket）实时处理

## 适用场景

- 手机上刷到好文，想快速沉淀到 Obsidian
- 需要统一管理公众号文章，不想手工复制粘贴
- 想把“收藏”流程自动化，减少整理成本

## 技术方案

核心思路：把飞书当成“远程控制台”，让本地 Agent 帮你干活。

技术栈：

- Node.js + TypeScript
- 飞书 SDK：`@larksuiteoapi/node-sdk`
- Agent 编排：LangChain
- 模型：DeepSeek（通过 `@langchain/openai` 兼容层接入）
- 抓取：Playwright
- 转换：Turndown（HTML -> Markdown）
- 保存：Obsidian CLI

## 端到端流程

1. 用户在飞书发公众号链接
2. `feishu-bridge` 收到事件并做消息去重
3. 调用 `runWechatAgent` 执行主流程
4. `crawl_wechat_article` 抓取网页并转 Markdown
5. 模型根据摘要选择 `dynamic_folder`
6. `save_to_obsidian` 生成 frontmatter 并写入 Obsidian
7. 飞书回复保存结果和路径

## 实现里几个关键点

### 1) 飞书消息去重，避免重复入库

飞书事件在某些情况下可能重复投递，我在桥接层做了 `message_id + TTL` 内存去重。  
这样同一条消息不会被重复处理，避免生成多份重复笔记。

### 2) 处理过程给用户“正在输入”反馈

在收到消息后先加 `Typing` reaction，处理结束后移除。  
用户体验明显更好，不会误以为机器人挂了。

### 3) 抓取后做结构化清洗再转 Markdown

抓取工具里会先移除 `script/style/iframe` 等噪音，再规范化链接和图片地址，然后交给 Turndown 转换。  
最终还会做空行压缩和长度限制，保证生成笔记可读、可控。

### 4) 目录分类“可控”，不是放飞模型

不是让模型自由输出目录，而是限定在 `OBSIDIAN_DYNAMIC_FOLDERS` 里二选一/多选一（或空）。  
这个策略能减少目录污染，长期维护成本低很多。

### 5) 保存格式统一，方便后续检索

每篇笔记都统一 frontmatter 字段：`title/tags/source/url/author/created`。  
后面做 Dataview、全文检索或二次加工都更顺。

## 快速开始（pnpm）

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

关键配置：

```env
DEEPSEEK_API_KEY=your_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_DOMAIN=feishu

OBSIDIAN_VAULT=你的Vault
OBSIDIAN_FOLDER=Clippings
OBSIDIAN_DYNAMIC_FOLDERS=AI学习法技能提升,产品增长,编程前端
```

### 3. 启动飞书模式

```bash
pnpm dev:feishu
```

## 我踩过的坑

### 坑 1：OAuth 403 / permission_error

报错类似：

`OAuth authentication is currently not allowed for this organization`

这个通常是认证策略问题，不一定是 VPN 本身导致。  
建议先确认调用链是不是走了 API Key，而不是 OAuth 会话。

### 坑 2：Obsidian 写入失败

重点检查两件事：

- `obsidian` 命令是否在 PATH
- `OBSIDIAN_VAULT` 是否配置正确

### 坑 3：机器人收到消息但不回

优先排查：

- 飞书事件订阅是否开启（`im.message.receive_v1`）
- 机器人权限是否覆盖发送/接收消息场景
- 应用可见范围是否包含当前会话

## 这个项目给我的收获

这个工具本身不复杂，但很实用。  
把“收藏一篇文章”从多步骤手工操作，变成“发一个链接”。

更重要的是，它让我把 AI 从“回答问题”变成“替我执行流程”的一部分。

如果你也在用 Obsidian 管理知识，且经常在手机上看公众号，这个方案可以直接拿去改造成你的工作流。

---

如果你想看下一篇，我可以继续写：

- 飞书机器人权限和事件订阅的最小配置清单
- 如何把这个流程扩展到小红书/即刻/网页剪藏
- 如何给 Obsidian 增加自动标签和周报汇总
