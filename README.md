# cat-crawl

一个将微信公众号文章抓取并保存到 Obsidian 的 Node.js 应用。

## 功能

- 输入公众号链接，自动抓取文章内容
- HTML 转 Markdown（保留结构）
- 根据文章内容自动选择动态目录（可配置）
- 通过 Obsidian CLI 保存到本地 Vault
- 支持飞书机器人长连接接入（阶段 2）

## 环境要求

- Node.js 20+
- Obsidian CLI 可用（命令 `obsidian`）
- DeepSeek API Key

## 安装

```bash
npm install
```

## 配置

复制环境变量模板：

```bash
cp .env.example .env
```

### 核心配置

- `DEEPSEEK_API_KEY`：必填
- `DEEPSEEK_BASE_URL`：默认 `https://api.deepseek.com`
- `DEEPSEEK_MODEL`：默认 `deepseek-chat`
- `OBSIDIAN_VAULT`：可选（也可在工具入参里传）
- `OBSIDIAN_FOLDER`：保存根目录，默认 `Clippings`
- `OBSIDIAN_DYNAMIC_FOLDERS`：候选动态目录，英文逗号分隔

示例：

```env
OBSIDIAN_DYNAMIC_FOLDERS=AI学习法技能提升,产品增长,编程前端
```

## 本地 CLI 模式

```bash
npm run dev -- "https://mp.weixin.qq.com/s/xxxx"
```

## 飞书模式（长连接）

先补充飞书配置：

- `FEISHU_ENABLED=true`
- `FEISHU_APP_ID=cli_xxx`
- `FEISHU_APP_SECRET=xxx`
- `FEISHU_DOMAIN=feishu`（国际版填 `lark`）

启动：

```bash
npm run dev -- --feishu
# 或
npm run dev:feishu
```

## 构建

```bash
npm run build
```

## 当前流程

1. 抓取公众号文章（Playwright）
2. 抽取摘要用于目录分类（DeepSeek）
3. 选择 `dynamic_folder`（不匹配则为空）
4. 保存到 `{folder}/{dynamicFolder}/YYYY-MM-DD {title}.md`
5. 返回保存结果
