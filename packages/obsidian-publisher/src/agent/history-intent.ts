import type { QueryScope } from "../history/history-store.js";

export type HistoryIntent = {
  shouldQuery: boolean;
  scope: QueryScope;
  tag?: string;
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

export function parseHistoryIntentFromModelOutput(modelOutput: string): HistoryIntent | null {
  const trimmed = modelOutput.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      should_query?: unknown;
      scope?: unknown;
      tag?: unknown;
    };

    const shouldQuery = Boolean(parsed.should_query);
    const scope: QueryScope = parsed.scope === "today" ? "today" : "all";
    const tag = typeof parsed.tag === "string" ? parsed.tag.trim() : "";

    return {
      shouldQuery,
      scope,
      tag: tag || undefined,
    };
  } catch {
    return null;
  }
}
