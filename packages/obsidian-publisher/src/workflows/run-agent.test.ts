import assert from 'node:assert/strict'
import test from 'node:test'
import { runAgent } from './run-agent.js'

test('runAgent should route supported video URLs to transcribe_video', async () => {
  let transcribeCalled = false
  let crawlCalled = false
  let saveCalled = false
  let persisted = false

  const result = await runAgent(
    '帮我处理这个视频 https://www.youtube.com/watch?v=demo123',
    undefined,
    {
      loadEnv: () =>
        ({
          obsidianFolder: 'Clippings',
          obsidianFolders: [],
          transcriptionProvider: 'whisper_cpp',
          whisperCppBin: 'whisper-cli',
          whisperCppModelPath: '/models/base.bin',
          whisperCppLanguage: undefined,
          geminiApiKey: 'gemini-demo-key',
          geminiModel: 'gemini-2.5-pro'
        }) as never,
      createTranscribeVideoTool: () =>
        ({
          invoke: async (input: { source: string }) => {
            transcribeCalled = true
            assert.equal(input.source, 'https://www.youtube.com/watch?v=demo123')
            return {
              title: 'YouTube Demo',
              source_url: 'https://www.youtube.com/watch?v=demo123',
              tags: ['video', 'transcript'],
              description: 'A short summary of the transcript.',
              content_markdown: '# YouTube Demo\n\nhello transcript',
              meta: {
                provider_used: 'whisper_cpp',
                fallback_used: false
              }
            }
          }
        }) as never,
      classifyFolder: async () => null,
      crawlWebArticleTool: {
        invoke: async () => {
          crawlCalled = true
          throw new Error('crawl should not be called for video URLs')
        }
      },
      createSaveToObsidianTool: () =>
        ({
          invoke: async (input: { title: string; content_markdown: string; folder?: string }) => {
            saveCalled = true
            assert.equal(input.title, 'YouTube Demo')
            assert.equal(Object.prototype.hasOwnProperty.call(input, 'dynamic_folder'), false)
            assert.equal(input.folder, undefined)
            assert.match(input.content_markdown, /hello transcript/)
            return {
              saved: true,
              vault: '知识库',
              path: 'Clippings/YouTube Demo.md',
              tags: ['video', 'transcript']
            }
          }
        }) as never,
      persistSuccessHistory: () => {
        persisted = true
      }
    }
  )

  assert.equal(transcribeCalled, true)
  assert.equal(crawlCalled, false)
  assert.equal(saveCalled, true)
  assert.equal(persisted, true)
  assert.deepEqual(result.usedTools, ['transcribe_video', 'save_to_obsidian'])
  assert.match(result.reply, /视频转写已成功保存到 Obsidian/)
  assert.doesNotMatch(result.reply, /分类：/)
  assert.match(result.reply, /知识库\/Clippings\/YouTube Demo\.md/)
})

test('runAgent should rely on save_to_obsidian to choose configured folder', async () => {
  let saveCalled = false

  const result = await runAgent(
    '帮我处理这个视频 https://www.youtube.com/watch?v=demo123',
    undefined,
    {
      loadEnv: () =>
        ({
          obsidianFolder: 'Clippings',
          obsidianFolders: [
            {
              folder: 'Clippings/AI/ai-coding',
              description: 'AI 编程相关'
            },
            {
              folder: 'Clippings/Writing',
              description: '写作与思考'
            }
          ],
          transcriptionProvider: 'whisper_cpp',
          whisperCppBin: 'whisper-cli',
          whisperCppModelPath: '/models/base.bin',
          whisperCppLanguage: undefined
        }) as never,
      createTranscribeVideoTool: () =>
        ({
          invoke: async () => ({
            title: 'A Practical Guide To Becoming An AI Engineer',
            source_url: 'https://www.youtube.com/watch?v=demo123',
            content_markdown: '# AI Engineer\n\nToday we talk about AI agents, LLM workflows and prompt engineering.',
            author: 'AI Engineer',
            published: '2026-03-29',
            description: 'A practical guide to becoming an AI engineer.',
            tags: ['video', 'ai']
          })
        }) as never,
      createSaveToObsidianTool: () =>
        ({
          invoke: async (input: Record<string, unknown>) => {
            saveCalled = true
            assert.equal(input.folder, undefined)
            return {
              saved: true,
              vault: '知识库',
              path: 'Clippings/AI/ai-coding/AI Engineer.md',
            }
          }
        }) as never,
      persistSuccessHistory: () => {}
    }
  )

  assert.equal(saveCalled, true)
  assert.deepEqual(result.usedTools, ['transcribe_video', 'save_to_obsidian'])
  assert.doesNotMatch(result.reply, /分类：/)
  assert.match(result.reply, /知识库\/Clippings\/AI\/ai-coding\/AI Engineer\.md/)
})

test('runAgent should rely on save_to_obsidian fallback to Clippings when classification is unsure', async () => {
  let saveCalled = false

  const result = await runAgent(
    '帮我处理这个视频 https://www.youtube.com/watch?v=demo123',
    undefined,
    {
      loadEnv: () =>
        ({
          obsidianFolder: 'Clippings',
          obsidianFolders: [
            {
              folder: 'Clippings/AI/ai-coding',
              description: 'AI 编程相关'
            }
          ],
          transcriptionProvider: 'whisper_cpp',
          whisperCppBin: 'whisper-cli',
          whisperCppModelPath: '/models/base.bin',
          whisperCppLanguage: undefined
        }) as never,
      createTranscribeVideoTool: () =>
        ({
          invoke: async () => ({
            title: '判断朋友与伴侣的标准',
            source_url: 'https://www.youtube.com/watch?v=demo123',
            content_markdown: '# 判断朋友与伴侣的标准\n\n关于关系判断的内容。',
            author: 'Creator',
            published: '2026-04-06',
            description: 'Relationship advice.',
            tags: ['video', 'relationship']
          })
        }) as never,
      createSaveToObsidianTool: () =>
        ({
          invoke: async (input: Record<string, unknown>) => {
            saveCalled = true
            assert.equal(input.folder, undefined)
            return {
              saved: true,
              vault: '知识库',
              path: 'Clippings/判断朋友与伴侣的标准.md',
            }
          }
        }) as never,
      persistSuccessHistory: () => {}
    }
  )

  assert.equal(saveCalled, true)
  assert.deepEqual(result.usedTools, ['transcribe_video', 'save_to_obsidian'])
  assert.match(result.reply, /知识库\/Clippings\/判断朋友与伴侣的标准\.md/)
})

test('runAgent should keep article URLs on crawl path', async () => {
  let transcribeCalled = false
  let crawlCalled = false
  let saveCalled = false

  const result = await runAgent('看看这个 https://example.com/post', undefined, {
    loadEnv: () =>
      ({
        obsidianFolder: 'Clippings'
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

test('runAgent should pass article description_source instead of eager description text', async () => {
  let saveCalled = false
  const contentMarkdown =
    '**Yaroslav Bulatov** @yaroslavvb [2026-04-06](https://x.com/yaroslavvb/status/1)\n\nMain tweet.\n\n---\n\n**Reply** @reply [2026-04-06](https://x.com/yaroslavvb/status/2)\n\nReply text.'

  await runAgent('看看这个 https://x.com/yaroslavvb/status/1', undefined, {
    loadEnv: () =>
      ({
        obsidianFolder: 'Clippings'
      }) as never,
    crawlWebArticleTool: {
      invoke: async () => ({
        title: 'Example Thread',
        author: '@yaroslavvb',
        published: '2026-04-06',
        source_url: 'https://x.com/yaroslavvb/status/1',
        content_markdown: contentMarkdown
      })
    },
    createSaveToObsidianTool: () =>
      ({
        invoke: async (input: { description?: string; description_source?: string; content_markdown: string }) => {
          saveCalled = true
          assert.equal(input.description, undefined)
          assert.equal(input.description_source, contentMarkdown)
          assert.equal(input.content_markdown, contentMarkdown)
          return {
            saved: true,
            vault: '知识库',
            path: 'Clippings/Example Thread.md'
          }
        }
      }) as never,
    persistSuccessHistory: () => {}
  })

  assert.equal(saveCalled, true)
})

test('runAgent should skip crawl when existing record is found by default', async () => {
  let crawlCalled = false

  const result = await runAgent('看看这个 https://example.com/post', undefined, {
    loadEnv: () =>
      ({
        obsidianFolder: 'Clippings'
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

test('runAgent should force recrawl when user explicitly asks for it', async () => {
  let crawlCalled = false
  let saveCalled = false

  const result = await runAgent('重新爬这个 https://example.com/post', undefined, {
    loadEnv: () =>
      ({
        obsidianFolder: 'Clippings'
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
