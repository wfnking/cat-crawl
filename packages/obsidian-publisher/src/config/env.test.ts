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

test('loadEnv should expose default transcription config', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })
  store.writeRaw({
    agent: {
      provider: 'gemini',
      gemini: {
        apiKey: 'gemini-demo-key'
      }
    }
  })

  setLocalConfigStoreForTest(store)
  try {
    const env = loadEnv()
    assert.equal(env.agent, 'gemini')
    assert.equal(env.aiProvider, 'gemini')
    assert.equal(env.aiChatProvider, undefined)
    assert.equal(env.aiClassifyProvider, undefined)
    assert.equal(env.aiSummarizeProvider, undefined)
    assert.equal(env.transcriptionProvider, 'whisper_cpp')
    assert.equal(env.whisperCppBin, 'whisper-cli')
    assert.equal(env.geminiModel, 'gemini-2.5-pro')
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
        model: 'gemini-2.5-pro'
      }
    },
    transcription: {
      provider: 'whisper_cpp',
      whisperCpp: {
        bin: '/opt/homebrew/bin/whisper-cli',
        modelPath: '/models/ggml-large-v3.bin',
        language: 'en'
      },
      gemini: {
        apiKey: 'gemini-demo-key',
        model: 'gemini-2.5-pro'
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
    assert.equal(env.transcriptionProvider, 'whisper_cpp')
    assert.equal(env.whisperCppBin, '/opt/homebrew/bin/whisper-cli')
    assert.equal(env.whisperCppModelPath, '/models/ggml-large-v3.bin')
    assert.equal(env.whisperCppLanguage, 'en')
    assert.equal(env.geminiApiKey, 'agent-gemini-key')
    assert.equal(env.geminiApiKeySource, 'GEMINI_API_KEY')
    assert.equal(env.geminiModel, 'gemini-2.5-pro')
    assert.equal(env.douyinCookie, 'ttwid=test-cookie-value')
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})

test('loadEnv should reject non-whisper transcription provider', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })
  store.writeRaw({
    ai: {
      provider: 'gemini',
      gemini: {
        apiKey: 'gemini-demo-key'
      }
    },
    transcription: {
      provider: 'gemini'
    }
  })

  setLocalConfigStoreForTest(store)
  try {
    assert.throws(() => loadEnv(), /Only whisper_cpp is supported/)
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
        model: 'gemini-2.5-pro'
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

test('loadEnv should fallback to GOOGLE_VERTEX_API_KEY when GEMINI_API_KEY is missing', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })
  store.writeRaw({
    agent: {
      provider: 'vertex',
      vertex: {
        apiKey: 'vertex-demo-key'
      }
    }
  })

  setLocalConfigStoreForTest(store)
  try {
    const env = loadEnv()
    assert.equal(env.geminiApiKey, 'vertex-demo-key')
    assert.equal(env.geminiApiKeySource, 'GOOGLE_VERTEX_API_KEY')
    assert.equal(env.vertexApiKey, 'vertex-demo-key')
    assert.equal(env.vertexApiKeySource, 'GOOGLE_VERTEX_API_KEY')
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})

test('loadEnv should prefer GEMINI_API_KEY over GOOGLE_VERTEX_API_KEY', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })
  store.writeRaw({
    agent: {
      provider: 'vertex',
      gemini: {
        apiKey: 'gemini-demo-key'
      },
      vertex: {
        apiKey: 'vertex-demo-key'
      }
    }
  })

  setLocalConfigStoreForTest(store)
  try {
    const env = loadEnv()
    assert.equal(env.geminiApiKey, 'gemini-demo-key')
    assert.equal(env.geminiApiKeySource, 'GEMINI_API_KEY')
    assert.equal(env.vertexApiKey, 'vertex-demo-key')
    assert.equal(env.vertexApiKeySource, 'GOOGLE_VERTEX_API_KEY')
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})

test('loadEnv should read vertex location and endpoint from structured config', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })
  store.writeRaw({
    agent: {
      provider: 'vertex',
      vertex: {
        apiKey: 'vertex-demo-key',
        location: 'us-central1',
        endpoint: 'https://aiplatform.googleapis.com'
      }
    }
  })

  setLocalConfigStoreForTest(store)
  try {
    const env = loadEnv()
    assert.equal(env.vertexLocation, 'us-central1')
    assert.equal(env.vertexEndpoint, 'https://aiplatform.googleapis.com')
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})

test('loadEnv should read camelCase flat config keys for whisper cpp', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })
  store.writeRaw({
    aiProvider: 'gemini',
    geminiApiKey: 'gemini-demo-key',
    transcriptionProvider: 'whisper_cpp',
    whisperCppBin: '/opt/homebrew/bin/whisper-cli',
    whisperCppModelPath: '/models/camel.bin'
  })

  setLocalConfigStoreForTest(store)
  try {
    const env = loadEnv()
    assert.equal(env.transcriptionProvider, 'whisper_cpp')
    assert.equal(env.whisperCppBin, '/opt/homebrew/bin/whisper-cli')
    assert.equal(env.whisperCppModelPath, '/models/camel.bin')
  } finally {
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})

test('loadEnv should ignore process env and use config only', () => {
  const { homeDir, cleanup } = createTempHome()
  const store = createLocalConfigStore({ homeDir })
  store.writeRaw({
    aiProvider: 'gemini',
    geminiApiKey: 'gemini-demo-key'
  })
  const prev = process.env.WHISPER_CPP_MODEL_PATH
  process.env.WHISPER_CPP_MODEL_PATH = '/env/should-not-be-used.bin'

  setLocalConfigStoreForTest(store)
  try {
    const env = loadEnv()
    assert.equal(env.whisperCppModelPath, undefined)
  } finally {
    if (prev === undefined) {
      delete process.env.WHISPER_CPP_MODEL_PATH
    } else {
      process.env.WHISPER_CPP_MODEL_PATH = prev
    }
    setLocalConfigStoreForTest(null)
    cleanup()
  }
})
