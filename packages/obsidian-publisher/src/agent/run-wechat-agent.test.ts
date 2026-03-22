import assert from 'node:assert/strict'
import test from 'node:test'
import { runWechatAgent } from './run-wechat-agent.js'

test('runWechatAgent should route supported video URLs to transcribe_video', async () => {
  let transcribeCalled = false
  let crawlCalled = false
  let persisted = false

  const result = await runWechatAgent(
    '帮我处理这个视频 https://www.youtube.com/watch?v=demo123',
    undefined,
    {
      loadEnv: () =>
        ({
          obsidianDynamicFolders: [],
          transcriptionProvider: 'whisper_cpp',
          whisperCppBin: 'whisper-cli',
          whisperCppModelPath: '/models/base.bin',
          whisperCppLanguage: undefined,
          geminiApiKey: 'gemini-demo-key',
          geminiModel: 'gemini-2.5-pro'
        }) as never,
      createTranscribeVideoTool: () =>
        ({
          invoke: async (input: { source: string; save: boolean }) => {
            transcribeCalled = true
            assert.equal(input.source, 'https://www.youtube.com/watch?v=demo123')
            assert.equal(input.save, true)
            return {
              saved: true,
              title: 'YouTube Demo',
              source_url: 'https://www.youtube.com/watch?v=demo123',
              vault: '知识库',
              path: 'Clippings/YouTube Demo.md',
              dynamic_folder: 'AI',
              tags: ['video', 'transcript'],
              transcript_markdown: '# YouTube Demo\n\nhello transcript',
              provider_used: 'whisper_cpp',
              fallback_used: false
            }
          }
        }) as never,
      crawlWebArticleTool: {
        invoke: async () => {
          crawlCalled = true
          throw new Error('crawl should not be called for video URLs')
        }
      },
      persistSuccessHistory: () => {
        persisted = true
      }
    }
  )

  assert.equal(transcribeCalled, true)
  assert.equal(crawlCalled, false)
  assert.equal(persisted, true)
  assert.deepEqual(result.usedTools, ['transcribe_video'])
  assert.match(result.reply, /视频转写已成功保存到 Obsidian/)
  assert.match(result.reply, /分类：`AI`/)
  assert.match(result.reply, /知识库\/Clippings\/YouTube Demo\.md/)
})

test('runWechatAgent should keep article URLs on crawl path', async () => {
  let transcribeCalled = false
  let crawlCalled = false
  let saveCalled = false

  const result = await runWechatAgent('看看这个 https://example.com/post', undefined, {
    loadEnv: () =>
      ({
        obsidianDynamicFolders: []
      }) as never,
    createTranscribeVideoTool: () =>
      ({
        invoke: async () => {
          transcribeCalled = true
          throw new Error('transcribe should not be called for article URLs')
        }
      }) as never,
    crawlWebArticleTool: {
      invoke: async () => {
        crawlCalled = true
        return {
          title: 'Example Article',
          author: 'Author',
          published: '2026-03-16',
          source_url: 'https://example.com/post',
          content_markdown: '# Example\n\nBody'
        }
      }
    },
    createSaveToObsidianTool: () =>
      ({
        invoke: async (input: { title: string }) => {
          saveCalled = true
          assert.equal(input.title, 'Example Article')
          return {
            saved: true,
            vault: '知识库',
            path: 'Clippings/Example Article.md'
          }
        }
      }) as never,
    persistSuccessHistory: () => {}
  })

  assert.equal(transcribeCalled, false)
  assert.equal(crawlCalled, true)
  assert.equal(saveCalled, true)
  assert.deepEqual(result.usedTools, ['crawl_web_article', 'save_to_obsidian'])
  assert.match(result.reply, /文章已成功保存到 Obsidian/)
})

test('runWechatAgent should skip crawl when existing record is found by default', async () => {
  let crawlCalled = false

  const result = await runWechatAgent('看看这个 https://example.com/post', undefined, {
    loadEnv: () =>
      ({
        obsidianDynamicFolders: []
      }) as never,
    findExistingSavedRecordByUrl: async () => ({
      createdAt: '2026-03-22T00:00:00.000Z',
      title: 'Existing Article',
      vault: '知识库',
      path: 'Clippings/Existing Article.md',
      sourceUrl: 'https://example.com/post'
    }),
    crawlWebArticleTool: {
      invoke: async () => {
        crawlCalled = true
        throw new Error('crawl should not be called when duplicate is skipped')
      }
    }
  } as never)

  assert.equal(crawlCalled, false)
  assert.deepEqual(result.usedTools, [])
  assert.match(result.reply, /之前已经帮您处理并保存过/)
})

test('runWechatAgent should force recrawl when user explicitly asks for it', async () => {
  let crawlCalled = false
  let saveCalled = false

  const result = await runWechatAgent('重新爬这个 https://example.com/post', undefined, {
    loadEnv: () =>
      ({
        obsidianDynamicFolders: []
      }) as never,
    findExistingSavedRecordByUrl: async () => ({
      createdAt: '2026-03-22T00:00:00.000Z',
      title: 'Existing Article',
      vault: '知识库',
      path: 'Clippings/Existing Article.md',
      sourceUrl: 'https://example.com/post'
    }),
    crawlWebArticleTool: {
      invoke: async () => {
        crawlCalled = true
        return {
          title: 'Refetched Article',
          author: 'Author',
          published: '2026-03-22',
          source_url: 'https://example.com/post',
          content_markdown: '# Refetched\n\nBody'
        }
      }
    },
    createSaveToObsidianTool: () =>
      ({
        invoke: async () => {
          saveCalled = true
          return {
            saved: true,
            vault: '知识库',
            path: 'Clippings/Refetched Article.md'
          }
        }
      }) as never,
    persistSuccessHistory: () => {}
  } as never)

  assert.equal(crawlCalled, true)
  assert.equal(saveCalled, true)
  assert.deepEqual(result.usedTools, ['crawl_web_article', 'save_to_obsidian'])
  assert.match(result.reply, /文章已成功保存到 Obsidian/)
})
