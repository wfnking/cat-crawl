import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentSetupConfig, getAgentSetupSteps } from './agent-wizard.js'

test('openai agent should expose required setup steps', () => {
  const steps = getAgentSetupSteps('openai')
  assert.deepEqual(
    steps.map((item) => item.key),
    ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']
  )
  assert.equal(steps[0]?.required, true)
  assert.equal(steps[1]?.defaultValue, 'https://api.openai.com/v1')
  assert.equal(steps[2]?.defaultValue, 'gpt-4o-mini')
})

test('deepseek agent should expose openai-compatible setup steps', () => {
  const steps = getAgentSetupSteps('deepseek')
  assert.deepEqual(
    steps.map((item) => item.key),
    ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']
  )
  assert.equal(steps[0]?.label, 'DeepSeek API Key')
  assert.equal(steps[1]?.defaultValue, 'https://api.deepseek.com/v1')
  assert.equal(steps[2]?.defaultValue, 'deepseek-chat')
})

test('gemini agent should expose required api key and model steps', () => {
  const steps = getAgentSetupSteps('gemini')
  assert.deepEqual(
    steps.map((item) => item.key),
    ['GEMINI_API_KEY', 'GEMINI_MODEL']
  )
  assert.equal(steps[0]?.required, true)
  assert.equal(steps[1]?.defaultValue, 'gemini-2.5-pro')
})

test('buildAgentSetupConfig should include selected agent', () => {
  const config = buildAgentSetupConfig('openai', {
    OPENAI_API_KEY: 'sk-demo',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_MODEL: 'gpt-4o-mini'
  })

  assert.equal(config.agent, 'openai')
  assert.equal(config.OPENAI_BASE_URL, 'https://api.openai.com/v1')
  assert.equal(config.OPENAI_MODEL, 'gpt-4o-mini')
})

test('buildAgentSetupConfig should include gemini values', () => {
  const config = buildAgentSetupConfig('gemini', {
    GEMINI_API_KEY: 'gemini-demo-key',
    GEMINI_MODEL: 'gemini-2.5-pro'
  })

  assert.equal(config.agent, 'gemini')
  assert.equal(config.GEMINI_API_KEY, 'gemini-demo-key')
  assert.equal(config.GEMINI_MODEL, 'gemini-2.5-pro')
})

test('buildAgentSetupConfig should include vertex values', () => {
  const config = buildAgentSetupConfig('vertex', {
    VERTEX_PROJECT: 'demo-project',
    VERTEX_LOCATION: 'us-central1',
    GEMINI_MODEL: 'gemini-2.5-pro'
  })

  assert.equal(config.agent, 'vertex')
  assert.equal(config.VERTEX_PROJECT, 'demo-project')
  assert.equal(config.VERTEX_LOCATION, 'us-central1')
  assert.equal(config.GEMINI_MODEL, 'gemini-2.5-pro')
})
