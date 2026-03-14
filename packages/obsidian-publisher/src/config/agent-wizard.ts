import type { AgentConfigValue } from "@cat-crawl/core";

export type AgentSetupStep = {
  key: string;
  label: string;
  required: boolean;
  defaultValue?: string;
};

export function getAgentSetupSteps(agent: AgentConfigValue): AgentSetupStep[] {
  if (agent === "deepseek") {
    return [
      {
        key: "DEEPSEEK_API_KEY",
        label: "DeepSeek API Key",
        required: true,
      },
      {
        key: "DEEPSEEK_MODEL",
        label: "DeepSeek Model (deepseek-chat/deepseek-reasoner)",
        required: true,
        defaultValue: "deepseek-chat",
      },
    ];
  }

  if (agent === "codex") {
    return [
      {
        key: "CODEX_MODEL",
        label: "Codex Model",
        required: false,
        defaultValue: "gpt-5-codex",
      },
      {
        key: "CODEX_BIN",
        label: "Codex Binary Path",
        required: false,
        defaultValue: "codex",
      },
    ];
  }

  return [];
}

export function buildAgentSetupConfig(
  agent: AgentConfigValue,
  answers: Record<string, string>,
): Record<string, string> {
  const output: Record<string, string> = {
    agent,
  };

  for (const [key, value] of Object.entries(answers)) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    output[key] = normalized;
  }

  return output;
}
