import { getLocalConfigStore } from '@cat-crawl/core'

export type AppEnv = {
  agent: 'deepseek' | 'gemini' | 'vertex'
  aiProvider: 'deepseek' | 'gemini' | 'vertex'
  aiChatProvider?: 'deepseek' | 'gemini' | 'vertex'
  aiClassifyProvider?: 'deepseek' | 'gemini' | 'vertex'
  aiSummarizeProvider?: 'deepseek' | 'gemini' | 'vertex'
  deepseekApiKey?: string
  deepseekBaseUrl: string
  deepseekModel: string
  transcriptionProvider: 'whisper_cpp'
  whisperCppBin: string
  whisperCppModelPath?: string
  whisperCppLanguage?: string
  geminiApiKey?: string
  googleApiKey?: string
  vertexApiKey?: string
  geminiApiKeySource?: 'GEMINI_API_KEY' | 'GOOGLE_API_KEY' | 'GOOGLE_VERTEX_API_KEY'
  vertexApiKeySource?: 'GOOGLE_VERTEX_API_KEY' | 'GOOGLE_API_KEY' | 'GEMINI_API_KEY'
  geminiModel: string
  vertexProject?: string
  vertexLocation?: string
  vertexEndpoint?: string
  douyinCookie?: string
  feishuEnabled: boolean
  feishuAppId?: string
  feishuAppSecret?: string
  feishuDomain: 'feishu' | 'lark'
  telegramEnabled: boolean
  telegramDmPolicy: string
  telegramBotToken?: string
  telegramTypingMode: 'never' | 'instant' | 'thinking' | 'message'
  telegramTypingIntervalSeconds: number
  discordEnabled: boolean
  discordBotToken?: string
  obsidianVault?: string
  obsidianFolder: string
  obsidianDynamicFolders: string[]
  maxToolSteps: number
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readFromPath(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root
  for (const segment of path) {
    const obj = asObject(current)
    if (!obj) {
      return undefined
    }
    current = obj[segment]
  }
  return current
}

function readStringFromPaths(root: Record<string, unknown>, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = readFromPath(root, path)
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function readFromStructuredConfig(name: string): string | undefined {
  const raw = getLocalConfigStore().readRaw()
  if (name === 'agent' || name === 'AI_PROVIDER') {
    return readStringFromPaths(raw, [
      ['ai', 'provider'],
      ['agent', 'provider']
    ])
  }
  if (name === 'AI_CHAT_PROVIDER') {
    return readStringFromPaths(raw, [['ai', 'tasks', 'chat', 'provider']])
  }
  if (name === 'AI_CLASSIFY_PROVIDER') {
    return readStringFromPaths(raw, [['ai', 'tasks', 'classify', 'provider']])
  }
  if (name === 'AI_SUMMARIZE_PROVIDER') {
    return readStringFromPaths(raw, [['ai', 'tasks', 'summarize', 'provider']])
  }
  if (name === 'DEEPSEEK_API_KEY') {
    return readStringFromPaths(raw, [
      ['ai', 'deepseek', 'apiKey'],
      ['agent', 'deepseek', 'apiKey']
    ])
  }
  if (name === 'DEEPSEEK_BASE_URL') {
    return readStringFromPaths(raw, [
      ['ai', 'deepseek', 'baseUrl'],
      ['agent', 'deepseek', 'baseUrl']
    ])
  }
  if (name === 'DEEPSEEK_MODEL') {
    return readStringFromPaths(raw, [
      ['ai', 'deepseek', 'model'],
      ['agent', 'deepseek', 'model']
    ])
  }
  const mappings: Record<string, string[]> = {
    channel: ['channel'],
    TRANSCRIPTION_PROVIDER: ['transcription', 'provider'],
    WHISPER_CPP_BIN: ['transcription', 'whisperCpp', 'bin'],
    WHISPER_CPP_MODEL_PATH: ['transcription', 'whisperCpp', 'modelPath'],
    WHISPER_CPP_LANGUAGE: ['transcription', 'whisperCpp', 'language'],
    OBSIDIAN_VAULT: ['obsidian', 'vault'],
    OBSIDIAN_FOLDER: ['obsidian', 'folder'],
    TELEGRAM_BOT_TOKEN: ['channels', 'telegram', 'botToken'],
    TELEGRAM_DM_POLICY: ['channels', 'telegram', 'dmPolicy'],
    TELEGRAM_TYPING_MODE: ['channels', 'telegram', 'typingMode'],
    DISCORD_BOT_TOKEN: ['channels', 'discord', 'token'],
    FEISHU_APP_ID: ['channels', 'feishu', 'accounts', 'main', 'appId'],
    FEISHU_APP_SECRET: ['channels', 'feishu', 'accounts', 'main', 'appSecret'],
    FEISHU_DOMAIN: ['channels', 'feishu', 'accounts', 'main', 'domain']
  }
  const boolMappings: Record<string, string[]> = {
    TELEGRAM_ENABLED: ['channels', 'telegram', 'enabled'],
    DISCORD_ENABLED: ['channels', 'discord', 'enabled'],
    FEISHU_ENABLED: ['channels', 'feishu', 'accounts', 'main', 'enabled']
  }
  const numberMappings: Record<string, string[]> = {
    TELEGRAM_TYPING_INTERVAL_SECONDS: ['channels', 'telegram', 'typingIntervalSeconds']
  }

  const path = mappings[name]
  if (path) {
    const value = readFromPath(raw, path)
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  if (name === 'OBSIDIAN_DYNAMIC_FOLDERS') {
    const value = readFromPath(raw, ['obsidian', 'dynamicFolders'])
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .join(',')
    }
    return undefined
  }

  if (name === 'GEMINI_API_KEY' || name === 'GEMINI_MODEL') {
    const candidatePaths =
      name === 'GEMINI_API_KEY'
        ? [
            ['ai', 'gemini', 'apiKey'],
            ['agent', 'gemini', 'apiKey'],
            ['transcription', 'gemini', 'apiKey']
          ]
        : [
            ['ai', 'gemini', 'model'],
            ['agent', 'gemini', 'model'],
            ['transcription', 'gemini', 'model'],
            ['ai', 'vertex', 'model'],
            ['agent', 'vertex', 'model']
          ]
    for (const candidatePath of candidatePaths) {
      const value = readFromPath(raw, candidatePath)
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    return undefined
  }

  if (name === 'GOOGLE_VERTEX_API_KEY') {
    return readStringFromPaths(raw, [
      ['ai', 'vertex', 'apiKey'],
      ['agent', 'vertex', 'apiKey']
    ])
  }

  if (name === 'VERTEX_LOCATION') {
    return readStringFromPaths(raw, [
      ['ai', 'vertex', 'location'],
      ['agent', 'vertex', 'location']
    ])
  }

  if (name === 'VERTEX_PROJECT') {
    return readStringFromPaths(raw, [
      ['ai', 'vertex', 'project'],
      ['agent', 'vertex', 'project']
    ])
  }

  if (name === 'VERTEX_ENDPOINT') {
    return readStringFromPaths(raw, [
      ['ai', 'vertex', 'endpoint'],
      ['agent', 'vertex', 'endpoint']
    ])
  }

  if (name === 'GOOGLE_API_KEY') {
    return readStringFromPaths(raw, [
      ['ai', 'google', 'apiKey'],
      ['agent', 'google', 'apiKey']
    ])
  }

  if (name === 'DOUYIN_COOKIE') {
    const value = readFromPath(raw, ['videoSources', 'douyin', 'cookie'])
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  const boolPath = boolMappings[name]
  if (boolPath) {
    const value = readFromPath(raw, boolPath)
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false'
    }
  }

  const numberPath = numberMappings[name]
  if (numberPath) {
    const value = readFromPath(raw, numberPath)
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

function toCamelCaseKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())
}

function readRaw(name: string): string | undefined {
  const structuredValue = readFromStructuredConfig(name)
  if (structuredValue) {
    return structuredValue
  }
  const camelValue = getLocalConfigStore().get(toCamelCaseKey(name))?.trim()
  if (camelValue) {
    return camelValue
  }
  const localValue = getLocalConfigStore().get(name)?.trim()
  if (localValue) {
    return localValue
  }
  return undefined
}

function mustGet(name: string): string {
  const value = readRaw(name)
  if (!value) {
    throw new Error(`Missing required config: ${name}`)
  }
  return value
}

function getNumber(name: string, defaultValue: number): number {
  const raw = readRaw(name)
  if (!raw) {
    return defaultValue
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid numeric env var ${name}: ${raw}`)
  }
  return n
}

function getList(name: string): string[] {
  const raw = readRaw(name)
  if (!raw) {
    return []
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getBoolean(name: string, defaultValue: boolean): boolean {
  const raw = readRaw(name)
  if (!raw) {
    return defaultValue
  }
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())
}

function getTelegramTypingMode(): 'never' | 'instant' | 'thinking' | 'message' {
  const raw = readRaw('TELEGRAM_TYPING_MODE')?.toLowerCase()
  if (!raw) {
    return 'thinking'
  }
  if (raw === 'never' || raw === 'instant' || raw === 'thinking' || raw === 'message') {
    return raw
  }
  throw new Error(`Invalid TELEGRAM_TYPING_MODE: ${raw}`)
}

function getTranscriptionProvider(
  name: 'TRANSCRIPTION_PROVIDER',
  defaultValue?: 'whisper_cpp'
): 'whisper_cpp' | undefined {
  const raw = readRaw(name)?.toLowerCase()
  if (!raw) {
    return defaultValue
  }
  if (raw === 'whisper_cpp') {
    return raw
  }
  throw new Error(`Invalid ${name}: ${raw}. Only whisper_cpp is supported.`)
}

function getAiProvider(
  name: 'AI_PROVIDER' | 'AI_CHAT_PROVIDER' | 'AI_CLASSIFY_PROVIDER' | 'AI_SUMMARIZE_PROVIDER',
  defaultValue?: 'deepseek' | 'gemini' | 'vertex'
): 'deepseek' | 'gemini' | 'vertex' | undefined {
  const raw = readRaw(name)?.toLowerCase()
  if (!raw) {
    return defaultValue
  }
  if (raw === 'deepseek' || raw === 'gemini' || raw === 'vertex') {
    return raw
  }
  throw new Error(`Invalid ${name}: ${raw}`)
}

function readFirstRawWithSource<T extends 'GEMINI_API_KEY' | 'GOOGLE_API_KEY' | 'GOOGLE_VERTEX_API_KEY'>(
  names: T[]
): {
  value?: string
  source?: T
} {
  for (const name of names) {
    const value = readRaw(name)
    if (value) {
      return {
        value,
        source: name
      }
    }
  }
  return {}
}

export function loadEnv(): AppEnv {
  const legacyAgent = readRaw('agent')?.toLowerCase()
  const aiProvider =
    getAiProvider('AI_PROVIDER') || (legacyAgent === 'gemini' ? 'gemini' : legacyAgent === 'vertex' ? 'vertex' : 'deepseek')
  const aiChatProvider = getAiProvider('AI_CHAT_PROVIDER')
  const aiClassifyProvider = getAiProvider('AI_CLASSIFY_PROVIDER')
  const aiSummarizeProvider = getAiProvider('AI_SUMMARIZE_PROVIDER')
  const configuredGeminiApiKey = readRaw('GEMINI_API_KEY') || undefined
  const configuredGoogleApiKey = readRaw('GOOGLE_API_KEY') || undefined
  const configuredVertexApiKey = readRaw('GOOGLE_VERTEX_API_KEY') || undefined
  const geminiAuth = readFirstRawWithSource(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_VERTEX_API_KEY'])
  const vertexAuth = readFirstRawWithSource(['GOOGLE_VERTEX_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'])
  const needDeepseekApiKey =
    aiProvider === 'deepseek' ||
    aiChatProvider === 'deepseek' ||
    aiClassifyProvider === 'deepseek' ||
    aiSummarizeProvider === 'deepseek'
  return {
    agent: aiProvider,
    aiProvider,
    aiChatProvider,
    aiClassifyProvider,
    aiSummarizeProvider,
    deepseekApiKey: needDeepseekApiKey
      ? mustGet('DEEPSEEK_API_KEY')
      : readRaw('DEEPSEEK_API_KEY') || undefined,
    deepseekBaseUrl: readRaw('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com',
    deepseekModel: readRaw('DEEPSEEK_MODEL') || 'deepseek-chat',
    transcriptionProvider:
      getTranscriptionProvider('TRANSCRIPTION_PROVIDER', 'whisper_cpp') || 'whisper_cpp',
    whisperCppBin: readRaw('WHISPER_CPP_BIN') || 'whisper-cli',
    whisperCppModelPath: readRaw('WHISPER_CPP_MODEL_PATH') || undefined,
    whisperCppLanguage: readRaw('WHISPER_CPP_LANGUAGE') || undefined,
    geminiApiKey: geminiAuth.value || undefined,
    googleApiKey: configuredGoogleApiKey,
    vertexApiKey: configuredVertexApiKey,
    geminiApiKeySource: geminiAuth.source,
    vertexApiKeySource: vertexAuth.source,
    geminiModel: readRaw('GEMINI_MODEL') || 'gemini-2.5-pro',
    vertexProject: readRaw('VERTEX_PROJECT') || undefined,
    vertexLocation: readRaw('VERTEX_LOCATION') || undefined,
    vertexEndpoint: readRaw('VERTEX_ENDPOINT') || undefined,
    douyinCookie: readRaw('DOUYIN_COOKIE') || undefined,
    feishuEnabled: getBoolean('FEISHU_ENABLED', false),
    feishuAppId: readRaw('FEISHU_APP_ID') || undefined,
    feishuAppSecret: readRaw('FEISHU_APP_SECRET') || undefined,
    feishuDomain: readRaw('FEISHU_DOMAIN')?.toLowerCase() === 'lark' ? 'lark' : 'feishu',
    telegramEnabled: getBoolean('TELEGRAM_ENABLED', false),
    telegramDmPolicy: readRaw('TELEGRAM_DM_POLICY') || 'pairing',
    telegramBotToken: readRaw('TELEGRAM_BOT_TOKEN') || undefined,
    telegramTypingMode: getTelegramTypingMode(),
    telegramTypingIntervalSeconds: getNumber('TELEGRAM_TYPING_INTERVAL_SECONDS', 6),
    discordEnabled: getBoolean('DISCORD_ENABLED', false),
    discordBotToken: readRaw('DISCORD_BOT_TOKEN') || undefined,
    obsidianVault: readRaw('OBSIDIAN_VAULT') || undefined,
    obsidianFolder: readRaw('OBSIDIAN_FOLDER') || 'Clippings',
    obsidianDynamicFolders: getList('OBSIDIAN_DYNAMIC_FOLDERS'),
    maxToolSteps: getNumber('MAX_TOOL_STEPS', 4)
  }
}
