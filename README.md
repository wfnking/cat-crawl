# cat-crawl

一个把网页文章抓取为 Markdown 并保存到 Obsidian 的多渠道 Agent（CLI / Feishu / Telegram /
Discord）。

## 功能

- 抓取网页文章并转为 Markdown
  - 已支持：微信公众号、虎嗅、大部分普通文章页
- 基于文章内容自动选择动态目录（可选）
- 保存到 Obsidian Vault
- 成功记录持久化到本地数据库：`~/.cat-crawl/history.db`
- Agent 支持历史查询：
  - 查看全部成功记录
  - 查看今天成功记录
  - 按标签查询成功记录
- 渠道支持：CLI、Feishu（WS）、Telegram（Polling）、Discord（Gateway 文本消息）
- Agent Provider 支持：
  - `deepseek`
  - `gemini`（通过 LangChain Gemini 封装）

## 环境要求

- Node.js 22+
- Obsidian CLI 可用（命令：`obsidian`）

## 安装

```bash
pnpm install
```

## 配置

优先使用全局配置（`~/.cat-crawl/config.json`）：

- 渠道：`cat-crawl obsidian config set channel <feishu|telegram|discord|all>`
- Agent：`cat-crawl obsidian config set agent <deepseek|gemini>`

`.env` 仅保留可选运行参数（例如 Obsidian 目录与 `MAX_TOOL_STEPS`）。如果需要，可从模板复制：

```bash
cp .env.example .env
```

## 运行

### CLI

```bash
pnpm dev -- "https://mp.weixin.qq.com/s/xxxx"
pnpm dev -- "https://m.huxiu.com/article/4794991.html"
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
cat-crawl obsidian config set channel telegram
cat-crawl obsidian config get channel
cat-crawl obsidian config get channel telegram
cat-crawl obsidian pairing approve telegram <code>
cat-crawl obsidian config set agent deepseek
cat-crawl obsidian config set agent gemini
cat-crawl obsidian config get agent
cat-crawl obsidian config get agent deepseek
```

说明：

- `obsidian config set channel telegram`：进入交互式向导，设置 Telegram
  Token、策略字段与 typing 行为（Polling 模式）。
- `obsidian config set channel <value>` 支持 `feishu` / `telegram` / `discord` / `all`。
- 当 `channels.telegram.dmPolicy=pairing` 时，未配对用户会收到 Pairing Code，管理员使用
  `cat-crawl obsidian pairing approve telegram <code>` 完成授权。
- `obsidian config set agent deepseek`：进入交互式向导，输入 DeepSeek 配置（API Key/Model，默认
  `deepseek-chat`）。
- `obsidian config set agent gemini`：进入交互式向导，输入 Gemini 配置（API Key/Model，默认
  `gemini-3.1-flash-lite-preview`）。
- `obsidian config get channel`：读取当前值。
- `obsidian config get channel telegram`：当键不存在时返回你提供的 fallback（这里是 `telegram`）。
- `obsidian config get agent`：读取当前 agent。
- `obsidian config get agent deepseek`：当键不存在时返回 fallback（这里是 `deepseek`）。

当你不带参数直接运行 `cat-crawl` 且已设置 `channel` 时，会按该渠道启动对应通道模式。

`obsidian config set channel ...` 后会把 `~/.cat-crawl/config.json` 写成分层结构（接近 openclaw）：

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

`obsidian config set agent deepseek` 后会写入：

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

`obsidian config set agent gemini` 后会写入：

```json
{
  "agent": {
    "provider": "gemini",
    "gemini": {
      "apiKey": "gemini-key",
      "model": "gemini-3.1-flash-lite-preview"
    }
  }
}
```

也支持统一的 `ai` 命名空间（用于更灵活地切换 provider）：

```json
{
  "ai": {
    "provider": "gemini",
    "tasks": {
      "chat": {
        "provider": "gemini"
      },
      "classify": {
        "provider": "deepseek"
      },
      "summarize": {
        "provider": "gemini"
      }
    },
    "deepseek": {
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-chat"
    },
    "gemini": {
      "apiKey": "gemini-key",
      "model": "gemini-3.1-flash-lite-preview"
    }
  }
}
```

说明：

- 若同时存在 `ai.provider` 与 `agent.provider`，优先使用 `ai.provider`。
- 若配置了 `ai.tasks.<task>.provider`，该任务会覆盖默认 provider。
- 旧的 `agent.*` 配置继续兼容。

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

## 当前处理流程

1. 接收用户消息
2. 识别是否是文章链接
3. 若是：抓取 -> 分类 -> 保存 Obsidian -> 写入成功历史
4. 若不是：
   - 优先识别是否历史查询意图并调用 `query_success_history`
   - 否则做简短聊天回复
