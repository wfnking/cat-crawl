# cat-crawl

`cat-crawl` 是一个把网页和视频内容整理后写进 Obsidian 的多渠道工具。

如果你在用 Obsidian，但一直觉得手机上不方便收藏文章，`cat-crawl` 就是为这个场景准备的。

平时在手机上刷到想收藏的文章、视频或者帖子，先丢进收藏夹，最后往往就是吃灰。  
而且等你真的想回看时，原文还有可能已经被删了。

`cat-crawl` 可以让你直接把链接发给飞书、Telegram、Discord 的机器人，或者直接丢给 CLI。  
它会自动抓取文章正文，或者提取视频里的文字内容，再整理成 Markdown，同步到你自己的 Obsidian。

如果你的 Obsidian 走 iCloud，同步之后在手机上也能直接看到保存结果。

对个人知识库场景来说，它更像一个专业定制的 `open-claw`，但更省 token。

## 当前能力

- 文章抓取（`crawl_web_article`）
  - 微信公众号（含新模板头部图区域）
  - X / Twitter（`x.com` / `twitter.com`）
  - 通用网页文章页
- 视频转写（`transcribe_video`）
  - 来源：YouTube、抖音、本地视频文件
  - ASR：`whisper.cpp`（当前仅支持本地 whisper.cpp）
  - 输出：章节化 Markdown（可带时间点链接）
- 保存到 Obsidian（支持动态目录策略）
- 成功记录写入本地数据库：`~/.cat-crawl/history.db`
- 渠道接入：CLI、Feishu、Telegram（Polling）、Discord
- Agent Provider：`openai` / `gemini` / `vertex`
  - `vertex` 走的是 Vertex AI 的 ADC/OAuth 认证，具体配置见下方配置示例即可

## 使用方式

你把链接丢进去，`cat-crawl` 会自动：

- 抓取文章正文
- 提取视频文字内容
- 整理成带章节结构的 Markdown
- 英文内容补中文翻译
- 写入你的 Obsidian 知识库

目前支持的入口：

- CLI
- Feishu
- Telegram
- Discord

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

cat-crawl obsidian config set agent <openai|gemini|vertex>
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
  "obsidian": {
    "vault": "知识库",
    "folder": "Clippings",
    "dynamicFolders": ["AI", "OPC", "English"]
  }
}
```

## 视频转写配置要点

### whisper.cpp

必须配置：

- `transcription.whisperCpp.bin`（如 `whisper-cli`）
- `transcription.whisperCpp.modelPath`（模型 `.bin` 绝对路径）

可选：

- `transcription.whisperCpp.language`（不填则自动识别）

### YouTube / 抖音

- 使用前请先在本机 **Chrome** 中登录：
  - `https://www.youtube.com`
  - `https://www.douyin.com`
- 当前视频抓取依赖浏览器会话态；未登录时容易出现下载失败、仅预览流或无音轨等问题。
- YouTube 依赖 `yt-dlp`，并由 `ffmpeg` 抽音频
- 抖音通过 Playwright + 浏览器 cookies 抓取视频源（并校验音轨）

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
