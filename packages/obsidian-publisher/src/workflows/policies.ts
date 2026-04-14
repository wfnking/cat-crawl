import type { QueryScope } from "../ingest/history/history-store.js";

export type HistoryIntent = {
  shouldQuery: boolean;
  scope: QueryScope;
  tag?: string;
};

type PickPolicyFolderInput = {
  title: string;
  summary: string;
  options: string[];
};

type FolderRule = {
  key: string;
  pattern: RegExp;
};

function extractTag(text: string): string | undefined {
  const direct = text.match(/(?:标签|tag)\s*[：: ]\s*([#\w\-\u4e00-\u9fa5]+)/i);
  if (direct?.[1]) {
    return direct[1].replace(/^#/, "").trim();
  }
  const byClause = text.match(/(?:根据|按)\s*标签\s*([#\w\-\u4e00-\u9fa5]+)/i);
  if (byClause?.[1]) {
    return byClause[1].replace(/^#/, "").trim();
  }
  return undefined;
}

export function parseHistoryIntentFromText(input: string): HistoryIntent {
  const text = input.trim().toLowerCase();
  if (!text) {
    return { shouldQuery: false, scope: "all" };
  }

  const hasHistoryWord = /历史|history|记录|records|成功记录|success/.test(text);
  const hasQueryWord = /查看|查询|列出|show|get|list|query|查/.test(text);
  const hasTagWord = /标签|tag/.test(text);
  const hasTodayWord = /今天|today/.test(text);

  const shouldQuery = (hasHistoryWord && hasQueryWord) || hasTodayWord || hasTagWord;
  if (!shouldQuery) {
    return { shouldQuery: false, scope: "all" };
  }

  const scope: QueryScope = hasTodayWord ? "today" : "all";
  const tag = extractTag(input);

  return {
    shouldQuery: true,
    scope,
    tag,
  };
}

export function shouldForceRecrawlFromText(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) {
    return false;
  }

  return /(继续抓取|继续处理|继续重抓|重新爬|重爬|重抓|重新抓取|重新处理|强制重爬|强制重抓|忽略历史|忽略重复|即使爬过|重新来一次|force recrawl|re-crawl|recrawl|reprocess)/i.test(
    text,
  );
}

const FOLDER_RULES: FolderRule[] = [
  {
    key: "ai",
    pattern:
      /(^|[^a-z])ai([^a-z]|$)|artificial intelligence|llm|agentic|machine learning|deep learning|prompt engineering|rag|人工智能|大模型|机器学习|智能体|提示词/u,
  },
  {
    key: "dsa",
    pattern: /data structure|algorithm|leetcode|算法|数据结构|刷题/u,
  },
  {
    key: "english",
    pattern:
      /english learning|english writing|ielts|toefl|vocabulary|pronunciation|grammar|英文写作|英语写作|英语学习|口语|语法/u,
  },
  {
    key: "go",
    pattern:
      /golang|go语言|\bgo\s+language\b|\bgo\s+runtime\b|\bgo\s+module(s)?\b|\bgo\s+toolchain\b|\bgin\b|\bgorm\b/u,
  },
  {
    key: "job",
    pattern: /interview|resume|job hunting|career|hiring|求职|面试|简历|跳槽/u,
  },
  {
    key: "opc",
    pattern:
      /创业|创业者|创始人|一人公司|个体创业|商业化|变现|公司经营|startup|founder|one person company|cross[- ]?border e[- ]?commerce|跨境电商|电商|独立开发|独立开发者|个人开发者|solo entrepreneur|indie hacker|indiehacker|side hustle|side project|bootstrap|bootstrapped|micro[- ]?saas|saas|mrr|arr|营收|收入|盈利|月入|年入|赚钱|副业|卖了|收购|acquired|exit/u,
  },
  {
    key: "procrastination",
    pattern: /procrastination|拖延|拖延症|专注|自律|习惯养成/u,
  },
  {
    key: "writing",
    pattern: /writing|copywriting|写作|文案|创作|写作技巧/u,
  },
];

function normalizeOptionKey(option: string): string {
  const normalized = option.trim().toLowerCase();
  if (normalized === "one person company") {
    return "opc";
  }
  return normalized;
}

export function pickPolicyFolder(input: PickPolicyFolderInput): string {
  const joined = `${input.title}\n${input.summary}`;

  for (const option of input.options) {
    const key = normalizeOptionKey(option);
    const matched = FOLDER_RULES.find((rule) => rule.key === key);
    if (matched && matched.pattern.test(joined)) {
      return option;
    }
  }

  return "";
}
