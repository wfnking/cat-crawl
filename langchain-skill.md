---
name: obsidian-clippings-cli
description: Create Obsidian clipping notes via Obsidian CLI using path pattern `{folder}/YYYY-MM-DD {title}.md`, with optional LLM-selected configured subfolders, auto-extract frontmatter properties, and write body content.
---

# Obsidian Clippings

当用户要把网页/摘录/文本保存到 Obsidian `Clippings` 目录，并要求：
- 文件路径遵循 `{folder}/YYYY-MM-DD {title}.md`
- 自动提取 `properties`（frontmatter）
- 正文保留为笔记主体

就使用此 skill。

## Output Contract

输出一个 Markdown 文件，结构固定：

1. YAML frontmatter（properties）
2. 空行
3. 正文（body）

模板：

```md
---
title: "<title>"
tags: [<tag1>, <tag2>]
source: "<source>"
url: "<url>"
author: "<author>"
created: "<ISO_DATETIME>"
---

<body>
```

## LangChain Tool Contract

`save_to_obsidian` 输入建议：

- `title: string`
- `source_url: string`
- `content_markdown: string`
- `author?: string`
- `source?: string`
- `tags?: string[]`
- `folder?: string`（可选，仅允许传入配置中的候选目录）
- `vault?: string`（可选，vault 名称 / vault id / 绝对路径）
- `path?: string`（通常不传，使用默认路径规则）
- `mode?: "create" | "append"`

默认路径规则：

- `{folder}/YYYY-MM-DD {title}.md`
- `folder` 来自 `OBSIDIAN_FOLDER`（默认 `Clippings`）
- 默认保存路径为 `{folder}/YYYY-MM-DD {title}.md`
- 分类候选项来自结构化配置 `obsidian.folders`
- 如果分类结果为空或没把握，回退到 `OBSIDIAN_FOLDER`

## 保存约定

优先级：`vault` 入参 > `OBSIDIAN_VAULT`。
工具通过 `obsidian` CLI 调用保存。
目录基础前缀由 `OBSIDIAN_FOLDER` 配置。

## Implementation Notes

- `WECHAT_SAVE_DIR` 不再需要。
- `tags/source/author` 缺失时由工具自动推导并回填到 frontmatter。
- 基础目录由 `obsidian.folder` 控制。
- 子目录候选由 `obsidian.folders` 提供，并由 LLM 在保存前受约束选择。
