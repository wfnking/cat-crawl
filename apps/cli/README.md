# cat-crawl (CLI)

`cat-crawl` is a CLI that crawls web/video content and saves clean Markdown notes into Obsidian.

## What It Supports

- Web article clipping: WeChat, Huxiu, generic article pages
- Video transcription: YouTube, Douyin, local video files
- Channels: CLI, Feishu, Telegram, Discord
- AI providers: OpenAI, Gemini, Vertex (ADC/OAuth)

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

## Vertex Notes

`vertex` uses ADC/OAuth (not API-key-only auth for Vertex endpoint):

```bash
gcloud auth application-default login
gcloud config set project <YOUR_PROJECT_ID>
```

Then set agent to vertex:

```bash
cat-crawl obsidian config set agent vertex
```

## Source Repo

https://github.com/wfnking/cat-crawl
