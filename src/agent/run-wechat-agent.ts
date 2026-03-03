import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { loadEnv } from "../config/env.js";
import { createDeepSeekModel } from "../services/deepseek.js";
import { crawlWechatArticleTool } from "../tools/crawl-wechat-article.js";
import { createSaveToObsidianTool } from "../tools/save-to-obsidian.js";
import { normalizeModelText } from "../utils/text.js";

const SYSTEM_PROMPT = `
你是一个消息处理助手，任务是把微信公众号文章保存到 Obsidian。

必须遵守：
1. 只有当用户输入包含 mp.weixin.qq.com 链接时，才调用工具。
2. 工具调用顺序固定：
   - 先调用 crawl_wechat_article
   - 再调用 save_to_obsidian
3. 如果输入不是公众号链接，直接回复：
   "当前仅支持微信公众号文章链接。"
4. 最终回复必须包含保存路径（vault + path），并保持简洁。
`;

export type AgentRunResult = {
  reply: string;
  usedTools: string[];
};

export async function runWechatAgent(userInput: string): Promise<AgentRunResult> {
  const env = loadEnv();
  const saveToObsidianTool = createSaveToObsidianTool(env);
  const tools = [crawlWechatArticleTool, saveToObsidianTool];
  const toolByName = new Map<string, { invoke: (input: unknown) => Promise<unknown> }>(
    tools.map((t) => [t.name, t as { invoke: (input: unknown) => Promise<unknown> }]),
  );
  const model = createDeepSeekModel(env).bindTools(tools);

  const messages = [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(userInput)];
  const usedTools: string[] = [];

  for (let i = 0; i < env.maxToolSteps; i += 1) {
    const aiMessage = await model.invoke(messages);
    messages.push(aiMessage);

    const toolCalls = aiMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return {
        reply: normalizeModelText(aiMessage.content) || "未生成有效回复。",
        usedTools,
      };
    }

    for (const call of toolCalls) {
      const callId = call.id ?? `tool_call_${i}_${usedTools.length}`;
      const tool = toolByName.get(call.name);
      if (!tool) {
        messages.push(
          new ToolMessage({
            tool_call_id: callId,
            content: `Tool not found: ${call.name}`,
          }),
        );
        continue;
      }

      try {
        const result = await tool.invoke(call.args ?? {});
        usedTools.push(call.name);
        messages.push(
          new ToolMessage({
            tool_call_id: callId,
            content: typeof result === "string" ? result : JSON.stringify(result),
          }),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        messages.push(
          new ToolMessage({
            tool_call_id: callId,
            content: `Tool execution failed: ${detail}`,
          }),
        );
      }
    }
  }

  return {
    reply: "处理超时，请重试。",
    usedTools,
  };
}
