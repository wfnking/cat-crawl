import assert from 'node:assert/strict'
import test from 'node:test'
import { __test__, createTranscribeVideoTool } from './transcribe-video.js'

test('transcribe video tool should transcribe local file without saving', async () => {
  const tool = createTranscribeVideoTool(
    {
      transcriptionProvider: 'whisper_cpp',
      whisperCppBin: 'whisper-cli',
      whisperCppModelPath: '/models/base.bin',
      whisperCppLanguage: undefined,
      geminiApiKey: 'gemini-demo-key',
      geminiModel: 'gemini-2.5-pro',
      obsidianFolder: 'Clippings',
      obsidianDynamicFolders: []
    } as never,
    {
      selectVideoHandler: () => ({ name: 'file' }),
      resolveFileVideoSource: async (source) => ({
        adapter: 'file',
        sourceUrl: source,
        mediaPath: source
      }),
      extractAudioFromVideo: async () => '/tmp/audio.mp3',
      transcribeAudio: async () => ({
        providerUsed: 'whisper_cpp',
        text: 'hello transcript',
        srt: '1\n00:00:00,000 --> 00:00:02,000\nhello transcript\n',
        fallbackUsed: false
      }),
      buildTranscriptMarkdown: async ({ sourceUrl, transcriptText, transcriptSrt }) => {
        assert.equal(sourceUrl, '/tmp/input.mp4')
        assert.equal(transcriptText, 'hello transcript')
        assert.match(transcriptSrt || '', /00:00:00,000 --> 00:00:02,000/)
        return { markdown: '## Local Video（00:00）\n\nhello transcript' }
      }
    }
  )

  const result = await tool.invoke({
    source: '/tmp/input.mp4',
    title: 'Local Video'
  })

  assert.equal(result.meta?.provider_used, 'whisper_cpp')
  assert.match(result.content_markdown, /## Local Video（00:00）/)
  assert.match(result.content_markdown, /hello transcript/)
})

test('transcribe video tool should return description and tags without folder classification', async () => {
  const tool = createTranscribeVideoTool(
    {
      transcriptionProvider: 'whisper_cpp',
      whisperCppBin: 'whisper-cli',
      whisperCppModelPath: '/models/base.bin',
      whisperCppLanguage: undefined,
      geminiApiKey: 'gemini-demo-key',
      geminiModel: 'gemini-2.5-pro',
      obsidianFolder: 'Clippings',
      obsidianDynamicFolders: []
    } as never,
    {
      selectVideoHandler: () => ({ name: 'file' }),
      resolveFileVideoSource: async (source) => ({
        adapter: 'file',
        sourceUrl: source,
        mediaPath: source
      }),
      extractAudioFromVideo: async () => '/tmp/audio.mp3',
      transcribeAudio: async () => ({
        providerUsed: 'whisper_cpp',
        text: 'saved transcript',
        srt: undefined,
        fallbackUsed: false
      }),
      buildTranscriptMarkdown: async ({ transcriptText }) => ({
        markdown: `## Saved Video\n\n${transcriptText}`,
        description: 'A practical transcript summary.',
        tags: ['ai', 'workflow']
      })
    }
  )

  const result = await tool.invoke({
    source: '/tmp/input.mp4',
    title: 'Saved Video'
  })

  assert.equal(result.title, 'Saved Video')
  assert.equal(result.description, 'A practical transcript summary.')
  assert.deepEqual(result.tags, ['video', 'transcript', 'ai', 'workflow'])
  assert.equal(result.dynamic_folder, undefined)
})

test('transcribe video tool should pass Douyin cookie to resolver', async () => {
  let receivedCookieHeader: string | undefined
  const tool = createTranscribeVideoTool(
    {
      transcriptionProvider: 'whisper_cpp',
      whisperCppBin: 'whisper-cli',
      whisperCppModelPath: '/models/base.bin',
      whisperCppLanguage: undefined,
      geminiApiKey: 'gemini-demo-key',
      geminiModel: 'gemini-2.5-pro',
      douyinCookie: 'ttwid=abc',
      obsidianFolder: 'Clippings',
      obsidianDynamicFolders: []
    } as never,
    {
      selectVideoHandler: () => ({ name: 'douyin' }),
      resolveDouyinVideoSource: async (_source, options) => {
        receivedCookieHeader = options?.cookieHeader
        return {
          adapter: 'douyin',
          sourceUrl: 'https://www.douyin.com/video/123456',
          mediaPath: '/tmp/input.mp4',
          title: 'Douyin Video'
        }
      },
      extractAudioFromVideo: async () => '/tmp/audio.mp3',
      transcribeAudio: async () => ({
        providerUsed: 'whisper_cpp',
        text: 'hello transcript',
        srt: '1\n00:00:00,000 --> 00:00:02,000\nhello transcript\n',
        fallbackUsed: false
      }),
      buildTranscriptMarkdown: async () => ({
        markdown: '## Douyin Video（00:00）\n\nhello transcript'
      })
    }
  )

  const result = await tool.invoke({
    source: 'https://v.douyin.com/ABCDE/'
  })

  assert.equal(receivedCookieHeader, 'ttwid=abc')
  assert.equal(result.source_url, 'https://www.douyin.com/video/123456')
})

test('normalizeVideoTitle should strip hashtags and source suffix into tags', () => {
  assert.deepEqual(
    __test__.normalizeVideoTitle(
      '一个很绝的英文写作开头手法：“钩子开头”,钩子使得好，读者跑不了。 #幼儿英语 #少儿英语启蒙 #英语写作 #美国小学#英语写作 - 抖音'
    ),
    {
      title: '一个很绝的英文写作开头手法：“钩子开头”,钩子使得好，读者跑不了。',
      tags: ['幼儿英语', '少儿英语启蒙', '英语写作', '美国小学']
    }
  )
})

test('shouldTranslateToChinese should detect non-Chinese transcript', () => {
  assert.equal(
    __test__.shouldTranslateToChinese(
      'Now I have two hooks that I am going to put here on the screen.'
    ),
    true
  )

  assert.equal(
    __test__.shouldTranslateToChinese('这是中文内容，主要讲英语写作的钩子开头。'),
    false
  )
})

test('pickGeminiSummarizeModel should route translation to pro preview', () => {
  assert.equal(__test__.pickGeminiSummarizeModel({ geminiModel: 'gemini-2.5-pro' } as any, true), 'gemini-2.5-pro')
  assert.equal(__test__.pickGeminiSummarizeModel({ geminiModel: 'gemini-2.5-pro' } as any, false), 'gemini-2.5-pro')
})
