# cat-crawl (CLI)

`cat-crawl` crawls web and video content, turns it into clean Markdown, and saves it into Obsidian.

Typical workflow: send a link to a Feishu, Telegram, or Discord bot, or pass it to the CLI. `cat-crawl` will fetch the article body or extract video transcripts, organize the content into readable Markdown, and write it into your Obsidian vault.

If your Obsidian vault syncs through iCloud, you can see the result directly on your phone.

For personal knowledge-base workflows, it feels like a specialized, lower-token `open-claw`.

## What It Supports

- Web article clipping: WeChat, X / Twitter, generic article pages
- Video transcription: YouTube, Douyin, local video files
- Channels: CLI, Feishu, Telegram, Discord
- AI providers: OpenAI, Gemini, Vertex (ADC/OAuth)

## What It Does

- Crawl article body from a link
- Extract speech/text from videos
- Organize content into chaptered Markdown
- Add Chinese translation for English content
- Save directly into Obsidian

## Prerequisites

- Node.js >= 22
- Obsidian CLI installed (`obsidian` command)
- For video transcription:
  - `ffmpeg`
  - `yt-dlp` (for YouTube)
  - `whisper-cli` + local whisper.cpp model file

## Install

```bash
npm install -g cat-crawl
```

## Basic Commands

```bash
# Start channel listeners
cat-crawl obsidian start --telegram
cat-crawl obsidian start --all-channels

# Run one-shot from CLI input/url
cat-crawl obsidian run "https://mp.weixin.qq.com/s/xxxx"
cat-crawl obsidian run "https://www.youtube.com/watch?v=xxxx"

# Configure channel / agent
cat-crawl obsidian config set channel telegram
cat-crawl obsidian config set agent openai
cat-crawl obsidian config set agent gemini
cat-crawl obsidian config set agent vertex

# Telegram pairing approval
cat-crawl obsidian pairing approve telegram <code>
```

## Config File

Config is stored in:

```text
~/.cat-crawl/config.json
```

Recommended nested format:

```json
{
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
      "modelPath": "/absolute/path/to/model.bin"
    }
  },
  "obsidian": {
    "vault": "知识库",
    "folder": "Clippings",
    "dynamicFolders": ["AI", "OPC", "English"]
  }
}
```

`vertex` uses Vertex AI's ADC/OAuth flow. Configure the agent through the CLI or `~/.cat-crawl/config.json`.

## Source Repo

[cat-crawl on GitHub](https://github.com/wfnking/cat-crawl)
