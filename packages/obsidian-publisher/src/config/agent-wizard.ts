import type { AgentConfigValue } from '@cat-crawl/core'

export type AgentSetupStep = {
  key: string
  label: string
  required: boolean
  defaultValue?: string
}

export function getAgentSetupSteps(agent: AgentConfigValue): AgentSetupStep[] {
  if (agent === 'deepseek') {
    return [
      {
        key: 'DEEPSEEK_API_KEY',
        label: 'DeepSeek API Key',
        required: true
      },
      {
        key: 'DEEPSEEK_MODEL',
        label: 'DeepSeek Model (deepseek-chat/deepseek-reasoner)',
        required: true,
        defaultValue: 'deepseek-chat'
      }
    ]
  }

  if (agent === 'gemini') {
    return [
      {
        key: 'GEMINI_API_KEY',
        label: 'Gemini API Key',
        required: true
      },
      {
        key: 'GEMINI_MODEL',
        label: 'Gemini Model',
        required: true,
        defaultValue: 'gemini-2.5-pro'
      }
    ]
  }

  if (agent === 'vertex') {
    return [
      {
        key: 'VERTEX_PROJECT',
        label: 'Vertex Project ID (optional)',
        required: false
      },
      {
        key: 'VERTEX_LOCATION',
        label: 'Vertex Location',
        required: true,
        defaultValue: 'us-central1'
      },
      {
        key: 'GEMINI_MODEL',
        label: 'Vertex Model',
        required: true,
        defaultValue: 'gemini-2.5-pro'
      }
    ]
  }

  return []
}

export function buildAgentSetupConfig(
  agent: AgentConfigValue,
  answers: Record<string, string>
): Record<string, string> {
  const output: Record<string, string> = {
    agent
  }

  for (const [key, value] of Object.entries(answers)) {
    const normalized = value.trim()
    if (!normalized) {
      continue
    }
    output[key] = normalized
  }

  return output
}
