import { OPENAI_COMPATIBLE_AGENT_VALUES, type AgentConfigValue } from '@cat-crawl/core'

export type AgentSetupStep = {
  key: string
  label: string
  required: boolean
  defaultValue?: string
}

const OPENAI_COMPATIBLE_PRESETS: Partial<
  Record<AgentConfigValue, { label: string; baseUrl: string; model: string }>
> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini'
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.1-8b-instant'
  },
  moonshot: {
    label: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k'
  },
  siliconflow: {
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3'
  },
  together: {
    label: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
  }
}

export function getAgentSetupSteps(agent: AgentConfigValue): AgentSetupStep[] {
  if ((OPENAI_COMPATIBLE_AGENT_VALUES as readonly string[]).includes(agent)) {
    const preset = OPENAI_COMPATIBLE_PRESETS[agent]
    return [
      {
        key: 'OPENAI_API_KEY',
        label: `${preset?.label || 'OpenAI Compatible'} API Key`,
        required: true
      },
      {
        key: 'OPENAI_BASE_URL',
        label: `${preset?.label || 'OpenAI Compatible'} Base URL`,
        required: true,
        defaultValue: preset?.baseUrl || 'https://api.openai.com/v1'
      },
      {
        key: 'OPENAI_MODEL',
        label: `${preset?.label || 'OpenAI Compatible'} Model`,
        required: true,
        defaultValue: preset?.model || 'gpt-4o-mini'
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
