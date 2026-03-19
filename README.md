# cat-crawl

一个把网页/视频内容整理成 Markdown 并保存到 Obsidian 的多渠道 Agent（CLI / Feishu / Telegram / Discord）。

## 当前能力

- 文章抓取（`crawl_web_article`）
  - 微信公众号（含新模板头部图区域）
  - 虎嗅
  - 通用网页文章页
- 视频转写（`transcribe_video`）
  - 来源：YouTube、抖音、本地视频文件
  - ASR：`whisper.cpp`（当前仅支持本地 whisper.cpp）
  - 输出：章节化 Markdown（可带时间点链接）
- 保存到 Obsidian（支持动态目录策略）
- 成功记录写入本地数据库：`~/.cat-crawl/history.db`
- 渠道接入：CLI、Feishu、Telegram（Polling）、Discord
- Agent Provider：`deepseek` / `gemini` / `vertex`

## 环境要求

- Node.js `>=22`
- `obsidian` CLI 可用
- 视频能力依赖：
  - `ffmpeg`
  - `yt-dlp`（YouTube）
  - `whisper-cli` + 模型文件（whisper.cpp）

## 安装与构建

```bash
pnpm install
pnpm build
```

如果你要全局使用命令：

```bash
npm link
# 如提示已存在旧链接，可先手动移除旧文件后再 link
```

## 命令

```bash
cat-crawl obsidian start [--feishu|--telegram|--discord|--all-channels]
cat-crawl obsidian run "<任意文本/URL>"

cat-crawl obsidian config set channel <feishu|telegram|discord|all>
cat-crawl obsidian config get channel [fallback]

cat-crawl obsidian config set agent <deepseek|gemini|vertex>
cat-crawl obsidian config get agent [fallback]

cat-crawl obsidian pairing approve telegram <code>
```

## 配置方式

默认读取 `~/.cat-crawl/config.json`（推荐）。

### 最小配置示例

```json
{
  "channel": "telegram",
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "<TELEGRAM_BOT_TOKEN>",
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist",
      "streamMode": "partial",
      "typingMode": "thinking",
      "typingIntervalSeconds": 6
    }
  },
  "agent": {
    "provider": "gemini",
    "gemini": {
      "apiKey": "<GEMINI_API_KEY>",
      "model": "gemini-3.1-flash-lite-preview"
    }
  },
  "transcription": {
    "provider": "whisper_cpp",
    "whisperCpp": {
      "bin": "whisper-cli",
      "modelPath": "/absolute/path/to/ggml-large-v3-turbo-q8_0.bin"
    }
  },
  "obsidianFolder": "Clippings"
}
```

## Vertex 配置（重点）

> 你遇到的错误：`ACCESS_TOKEN_TYPE_UNSUPPORTED`
>
> 这是因为 Vertex endpoint（`aiplatform.googleapis.com`）不接受 Gemini API Key 这类 key 方式；需要 **ADC/OAuth2**（用户凭证或服务账号）。

### 正确做法

1. 本机登录 ADC（开发机）

```bash
gcloud auth application-default login
gcloud config set project <YOUR_GCP_PROJECT_ID>
```

2. 设为 Vertex provider

```bash
cat-crawl obsidian config set agent vertex
```

向导中填写：
- `VERTEX_PROJECT`（可选，通常可留空，走 gcloud 当前 project）
- `VERTEX_LOCATION`（建议 `us-central1`）
- `GEMINI_MODEL`（例如 `gemini-3.1-flash-lite-preview`）

3. 配置文件可写成：

```json
{
  "agent": {
    "provider": "vertex",
    "vertex": {
      "project": "your-gcp-project-id",
      "location": "us-central1",
      "model": "gemini-3.1-flash-lite-preview"
    }
  }
}
```

### 服务账号方式（服务器）

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

并确保服务账号具备 Vertex AI 调用权限。

### 注意

- `vertex` 模式下不建议配置 `GOOGLE_VERTEX_API_KEY`。
- 即使配置了 key，也不能替代 ADC/OAuth2 去调用 Vertex endpoint。

## 视频转写配置要点

### whisper.cpp

必须配置：

- `transcription.whisperCpp.bin`（如 `whisper-cli`）
- `transcription.whisperCpp.modelPath`（模型 `.bin` 绝对路径）

可选：

- `transcription.whisperCpp.language`（不填则自动识别）

### YouTube / 抖音

- YouTube 依赖 `yt-dlp`，并由 `ffmpeg` 抽音频
- 抖音通过 Playwright + 浏览器 cookies 抓取视频源（并校验音轨）

## 微信文章说明

- 发布时间优先解析页面时间字段，缺少年份时会回退使用微信页面时间戳推断。
- 对微信新模板头部图区域会提取图片并转成 Markdown 图片列表。
- Obsidian/Markdown 不支持原生“可滑动轮播”交互，默认以静态图集方式展示。

## 本地开发

```bash
pnpm dev -- obsidian run "https://mp.weixin.qq.com/s/xxxx"
pnpm dev:telegram
pnpm dev:feishu
pnpm dev:discord
pnpm dev:all
```

## 测试

```bash
pnpm test
```

## 构建

```bash
pnpm build
```
