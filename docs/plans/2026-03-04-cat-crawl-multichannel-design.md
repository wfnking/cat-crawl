# cat-crawl 多渠道与历史能力设计（2026-03-04）

## 背景与目标

本次目标：

1. 增加 Telegram 与 Discord 的消息接入能力。
2. 将“成功抓取并保存”的历史记录持久化到本地数据库 `~/.cat-crawl`。
3. 提供 AI 可调用的历史查询能力：查看全部成功记录、查看今天成功记录、按标签查询。
4. 为发布到 npm 与 Homebrew 做工程化准备。

## 设计原则

- 单一业务链路：不同渠道复用同一个 Agent 入口，避免逻辑分叉。
- 渠道适配与业务解耦：渠道负责收发消息，Agent 负责意图理解和工具编排。
- 历史数据可追溯：每次成功保存 Obsidian 后落库。
- 失败隔离：历史写入失败不影响主流程回复。

## 总体架构

### 1. Ingress（入口层）

- CLI 入口（现有）
- Feishu WebSocket（现有，改接统一入口）
- Telegram Webhook（新增）
- Discord Gateway 文本消息（新增）

### 2. Adapter（统一消息模型）

各入口转换为统一上下文：

- `channel`: `cli | feishu | telegram | discord`
- `senderId`
- `roomId`
- `messageId`
- `text`

### 3. Agent（业务编排）

- 保留核心抓取与保存链路。
- 新增历史查询 tool：`query_success_history`。
- 非链接输入下，Agent 优先判断是否为历史查询意图，命中则调用 history tool；否则走简短聊天。

### 4. Persistence（持久化）

使用 SQLite 文件数据库：

- 目录：`~/.cat-crawl`
- 文件：`~/.cat-crawl/history.db`

## 数据模型

表：`success_records`

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `created_at` TEXT NOT NULL（ISO 时间）
- `source` TEXT NOT NULL（当前重点：`wechat | x`）
- `channel` TEXT NOT NULL（`cli | feishu | telegram | discord`）
- `source_url` TEXT NOT NULL
- `title` TEXT NOT NULL
- `tags_json` TEXT NOT NULL（JSON array）
- `vault` TEXT NOT NULL
- `path` TEXT NOT NULL
- `dynamic_folder` TEXT（可空）
- `author` TEXT（可空）
- `sender_id` TEXT（可空）
- `room_id` TEXT（可空）
- `message_id` TEXT（可空）

索引：

- `idx_success_created_at`
- `idx_success_source`
- `idx_success_channel`

## 查询能力（Agent Tool）

工具：`query_success_history`

输入：

- `scope`: `all | today`
- `tag`: 可选
- `limit`: 默认 20，最大 100

输出：

- 命中总数
- 过滤条件回显
- 记录列表（时间、来源、标题、标签、保存路径、URL）

## 渠道策略

### Telegram

- 使用 Webhook 入站。
- 使用 Bot API `sendMessage` 出站。
- 可选校验 `X-Telegram-Bot-Api-Secret-Token`。

### Discord

- 使用 Bot Gateway 监听文本消息（`messageCreate`）。
- 忽略 bot/self 消息，避免回环。
- 回复采用消息回复模式。

说明：Discord 普通文本消息读取不走入站 HTTP Webhook，需 Gateway。

## 错误处理

- 渠道去重：基于 `message_id` 的内存 TTL 去重。
- 历史写入失败：记录日志，不阻断主流程。
- 抓取/保存失败：返回明确提示，便于重试。
- 配置缺失：启动时快速失败并报告缺失项。

## 发布策略

### npm

- 配置 `bin` 为 `cat-crawl`。
- 去除 `private`，补全 `files`、`main`、`types`、`engines`。
- `prepublishOnly` 触发构建。

### Homebrew

- 提供 tap formula 模板 `Formula/cat-crawl.rb`。
- 使用发布 tarball 安装并暴露 `cat-crawl` 命令。

## 非目标（本次不做）

- 多 worker 队列与重试系统
- 全量监控告警平台接入
- 非 `wechat/x` 的新内容源抓取器
