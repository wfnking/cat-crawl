import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { Codex } from "@openai/codex-sdk";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { AppEnv } from "../config/env.js";

type CodexModelOptions = {
  timeout?: number;
};

type CodexInvokeResult = {
  content: string;
};

const require = createRequire(import.meta.url);

function resolveCodexBinaryPath(raw: string): string {
  const value = raw.trim();
  if (value && value !== "codex") {
    return value;
  }
  const localBin = join(process.cwd(), "node_modules", ".bin", "codex");
  if (existsSync(localBin)) {
    return localBin;
  }
  try {
    const packageJsonPath = require.resolve("@openai/codex/package.json");
    const packageDir = packageJsonPath.replace(/package\.json$/, "");
    const packageBin = join(packageDir, "bin", "codex.js");
    if (existsSync(packageBin)) {
      return packageBin;
    }
  } catch {
    // fall through to PATH lookup
  }
  return "codex";
}

function renderMessagesAsPrompt(messages: BaseMessage[]): string {
  return messages
    .map((message) => {
      if (message instanceof SystemMessage) {
        return `System:\n${String(message.content).trim()}`;
      }
      if (message instanceof AIMessage) {
        return `Assistant:\n${String(message.content).trim()}`;
      }
      if (message instanceof HumanMessage) {
        return `User:\n${String(message.content).trim()}`;
      }
      return `Message:\n${String(message.content).trim()}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function createCodexModel(env: AppEnv, options: CodexModelOptions = {}) {
  const client = new Codex({
    codexPathOverride: resolveCodexBinaryPath(env.codexBin || "codex"),
  });

  return {
    async invoke(messages: BaseMessage[]): Promise<CodexInvokeResult> {
      const thread = client.startThread({
        model: env.codexModel,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchEnabled: false,
        workingDirectory: process.cwd(),
      });
      const turn = await thread.run(
        [
          "You are operating as a plain text model for a content-processing bot.",
          "Do not edit files, do not run commands, do not propose patches unless explicitly asked.",
          "Return only the final answer requested by the prompt.",
          "",
          renderMessagesAsPrompt(messages),
        ].join("\n"),
        { signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined },
      );
      return {
        content: turn.finalResponse.trim(),
      };
    },
  };
}

export const __test__ = {
  renderMessagesAsPrompt,
  resolveCodexBinaryPath,
};
