# cat-crawl

一个把微信公众号文章抓取为 Markdown 并保存到 Obsidian 的多渠道 Agent（CLI / Feishu / Telegram / Discord）。

## 功能

- 抓取微信公众号文章并转为 Markdown
- 基于文章内容自动选择动态目录（可选）
- 保存到 Obsidian Vault（通过 Obsidian CLI）
- 成功记录持久化到本地数据库：`~/.cat-crawl/history.db`
- Agent 支持历史查询：
  - 查看全部成功记录
  - 查看今天成功记录
  - 按标签查询成功记录
- 渠道支持：CLI、Feishu（WS）、Telegram（Polling）、Discord（Gateway 文本消息）

## 环境要求

- Node.js 22+
- Obsidian CLI 可用（命令：`obsidian`）

## 安装

```bash
pnpm install
```

## 配置

优先使用全局配置（`~/.cat-crawl/config.json`）：

- 渠道：`cat-crawl set channel <feishu|telegram|discord|all>`
- Agent：`cat-crawl set agent deepseek`

`.env` 仅保留可选运行参数（例如 Obsidian 目录与 `MAX_TOOL_STEPS`）。如果需要，可从模板复制：

```bash
cp .env.example .env
```

## 运行

### CLI

```bash
pnpm dev -- "https://mp.weixin.qq.com/s/xxxx"
```

历史查询示例：

```bash
pnpm dev -- "查看历史成功记录"
pnpm dev -- "查看今天的成功记录"
pnpm dev -- "根据标签 ai 查询"
```

## 本地配置（~/.cat-crawl）

cat-crawl 的本地运行配置会保存在：

- `~/.cat-crawl/config.json`

可用命令：

```bash
cat-crawl set channel telegram
cat-crawl get channel
cat-crawl get channel telegram
cat-crawl pairing approve telegram <code>
cat-crawl set agent deepseek
cat-crawl get agent
cat-crawl get agent deepseek
```

说明：

- `set channel telegram`：进入交互式向导，设置 Telegram Token、策略字段与 typing 行为（Polling 模式）。
- `set channel <value>` 支持 `feishu` / `telegram` / `discord` / `all`，其中 `feishu|discord` 也会进入对应交互式字段收集。
- 当 `channels.telegram.dmPolicy=pairing` 时，未配对用户会收到 Pairing Code，管理员使用 `cat-crawl pairing approve telegram <code>` 完成授权。
- `set agent deepseek`：进入交互式向导，输入 DeepSeek 配置（API Key/Model，默认 `deepseek-chat`），并写入分层 `agent` 配置。
- `set agent <value>` 目前支持 `deepseek`，后续可扩展更多 Agent。
- `get channel`：读取当前值。
- `get channel telegram`：当键不存在时返回你提供的 fallback（这里是 `telegram`）。
- `get agent`：读取当前 agent。
- `get agent deepseek`：当键不存在时返回 fallback（这里是 `deepseek`）。
- `gateway` 键已废弃，不再支持读写。

当你不带参数直接运行 `cat-crawl` 且已设置 `channel` 时，会按该渠道启动对应通道模式。

`set channel ...` 后会把 `~/.cat-crawl/config.json` 写成分层结构（接近 openclaw）：

```json
{
  "channel": "telegram",
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "xxx",
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist",
      "streamMode": "partial",
      "typingMode": "thinking",
      "typingIntervalSeconds": 6
    },
    "discord": {
      "enabled": false,
      "groupPolicy": "allowlist",
      "guilds": {}
    },
    "feishu": {
      "accounts": {
        "main": {
          "enabled": false,
          "domain": "feishu"
        }
      }
    }
  }
}
```

`set agent deepseek` 后会写入：

```json
{
  "agent": {
    "provider": "deepseek",
    "deepseek": {
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-chat"
    }
  }
}
```

### Feishu

```bash
pnpm dev:feishu
# 等价于
pnpm dev -- --feishu
```

### Telegram（Polling）

```bash
pnpm dev:telegram
# 等价于
pnpm dev -- --telegram
```

### Discord（Gateway）

```bash
pnpm dev:discord
# 等价于
pnpm dev -- --discord
```

### 同时启动所有渠道

```bash
pnpm dev:all
# 等价于
pnpm dev -- --all-channels
```

## 构建与测试

```bash
pnpm build
pnpm test
```

## 发布到 npm

1. 登录 npm

```bash
npm login
```

2. 调整版本并发布

```bash
npm version patch
npm publish
```

## 发布到 Homebrew

仓库内提供了 formula 模板：`Formula/cat-crawl.rb`。

发布流程：

1. 先发布 npm 包或 GitHub Release tarball
2. 在你的 tap 仓库更新 formula 中的 `url` 与 `sha256`
3. 提交后可安装：

```bash
brew tap <your-org>/cat-crawl
brew install cat-crawl
```

## 当前处理流程

1. 接收用户消息
2. 识别是否是公众号链接
3. 若是：抓取 -> 分类 -> 保存 Obsidian -> 写入成功历史
4. 若不是：
   - 优先识别是否历史查询意图并调用 `query_success_history`
   - 否则做简短聊天回复
