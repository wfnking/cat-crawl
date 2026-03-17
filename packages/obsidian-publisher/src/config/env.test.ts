import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocalConfigStore, setLocalConfigStoreForTest } from '@cat-crawl/core'
import { loadEnv } from './env.js'

function createTempHome(): { homeDir: string; cleanup: () => void } {
  const homeDir = mkdtempSync(join(tmpdir(), 'cat-crawl-obsidian-env-'))
  return {
    homeDir,
    cleanup: () => rmSync(homeDir, { recursive: true, force: true })
  }
}

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('loadEnv should expose default transcription config', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })

  setLocalConfigStoreForTest(store)
  try {
    const env = withEnv({ agent: 'gemini', GEMINI_API_KEY: 'gemini-demo-key' }, () => loadEnv())
    assert.equal(env.agent, 'gemini')
    assert.equal(env.aiProvider, 'gemini')
    assert.equal(env.aiChatProvider, undefined)
    assert.equal(env.aiClassifyProvider, undefined)
    assert.equal(env.aiSummarizeProvider, undefined)
    assert.equal(env.transcriptionProvider, 'whisper_cpp')
    assert.equal(env.transcriptionFallbackProvider, 'gemini')
    assert.equal(env.whisperCppBin, 'whisper-cli')
    assert.equal(env.geminiModel, 'gemini-3.1-flash-lite-preview')
    assert.equal(env.geminiApiKey, 'gemini-demo-key')
    assert.equal(env.geminiApiKeySource, 'GEMINI_API_KEY')
    assert.equal(env.douyinCookie, undefined)
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})

test('loadEnv should read transcription config from structured config', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })
  store.writeRaw({
    agent: {
      provider: 'gemini',
      gemini: {
        apiKey: 'agent-gemini-key',
        model: 'gemini-3.1-flash-lite-preview'
      }
    },
    transcription: {
      provider: 'gemini',
      fallbackProvider: 'whisper_cpp',
      whisperCpp: {
        bin: '/opt/homebrew/bin/whisper-cli',
        modelPath: '/models/ggml-large-v3.bin',
        language: 'en'
      },
      gemini: {
        apiKey: 'gemini-demo-key',
        model: 'gemini-3.1-flash-lite-preview'
      }
    },
    videoSources: {
      douyin: {
        cookie: 'ttwid=test-cookie-value'
      }
    }
  })

  setLocalConfigStoreForTest(store)
  try {
    const env = loadEnv()
    assert.equal(env.agent, 'gemini')
    assert.equal(env.aiProvider, 'gemini')
    assert.equal(env.transcriptionProvider, 'gemini')
    assert.equal(env.transcriptionFallbackProvider, 'whisper_cpp')
    assert.equal(env.whisperCppBin, '/opt/homebrew/bin/whisper-cli')
    assert.equal(env.whisperCppModelPath, '/models/ggml-large-v3.bin')
    assert.equal(env.whisperCppLanguage, 'en')
    assert.equal(env.geminiApiKey, 'agent-gemini-key')
    assert.equal(env.geminiApiKeySource, 'GEMINI_API_KEY')
    assert.equal(env.geminiModel, 'gemini-3.1-flash-lite-preview')
    assert.equal(env.douyinCookie, 'ttwid=test-cookie-value')
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})

test('loadEnv should support ai namespace with task-level provider overrides', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })
  store.writeRaw({
    ai: {
      provider: 'gemini',
      tasks: {
        classify: { provider: 'deepseek' },
        summarize: { provider: 'gemini' }
      },
      deepseek: {
        apiKey: 'deepseek-key',
        model: 'deepseek-chat'
      },
      gemini: {
        apiKey: 'gemini-key',
        model: 'gemini-3.1-flash-lite-preview'
      }
    }
  })

  setLocalConfigStoreForTest(store)
  try {
    const env = loadEnv()
    assert.equal(env.agent, 'gemini')
    assert.equal(env.aiProvider, 'gemini')
    assert.equal(env.aiChatProvider, undefined)
    assert.equal(env.aiClassifyProvider, 'deepseek')
    assert.equal(env.aiSummarizeProvider, 'gemini')
    assert.equal(env.deepseekApiKey, 'deepseek-key')
    assert.equal(env.geminiApiKey, 'gemini-key')
    assert.equal(env.geminiApiKeySource, 'GEMINI_API_KEY')
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})

test('loadEnv should fallback to VERTEX_API_KEY when GEMINI_API_KEY is missing', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })

  setLocalConfigStoreForTest(store)
  try {
    const env = withEnv(
      {
        agent: 'gemini',
        GEMINI_API_KEY: undefined,
        VERTEX_API_KEY: 'vertex-demo-key'
      },
      () => loadEnv()
    )
    assert.equal(env.geminiApiKey, 'vertex-demo-key')
    assert.equal(env.geminiApiKeySource, 'VERTEX_API_KEY')
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})

test('loadEnv should prefer GEMINI_API_KEY over VERTEX_API_KEY', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })

  setLocalConfigStoreForTest(store)
  try {
    const env = withEnv(
      {
        agent: 'gemini',
        GEMINI_API_KEY: 'gemini-demo-key',
        VERTEX_API_KEY: 'vertex-demo-key'
      },
      () => loadEnv()
    )
    assert.equal(env.geminiApiKey, 'gemini-demo-key')
    assert.equal(env.geminiApiKeySource, 'GEMINI_API_KEY')
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})
