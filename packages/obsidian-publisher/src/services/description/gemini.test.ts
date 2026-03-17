import assert from 'node:assert/strict'
import test from 'node:test'
import { generateDescriptionWithGemini } from './gemini.js'

test('generateDescriptionWithGemini should request one-sentence summary', async () => {
  const description = await generateDescriptionWithGemini('正文内容', {
    apiKey: 'gemini-demo-key',
    fetchImpl: async (input, init) => {
      assert.match(String(input), /gemini-3.1-flash-lite-preview:generateContent/)
      assert.match(String(input), /key=gemini-demo-key/)
      assert.match(String(init?.body), /Return only the sentence/)
      assert.match(String(init?.body), /正文内容/)
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '这篇文章讨论了如何用钩子开头增强英文写作的吸引力。' }]
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
  })

  assert.equal(description, '这篇文章讨论了如何用钩子开头增强英文写作的吸引力。')
})
