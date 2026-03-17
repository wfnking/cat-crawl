import assert from 'node:assert/strict'
import test from 'node:test'
import { __test__, createTranscribeVideoTool } from './transcribe-video.js'

test('transcribe video tool should transcribe local file and skip save when disabled', async () => {
  const tool = createTranscribeVideoTool(
    {
      transcriptionProvider: 'whisper_cpp',
      transcriptionFallbackProvider: 'gemini',
      whisperCppBin: 'whisper-cli',
      whisperCppModelPath: '/models/base.bin',
      whisperCppLanguage: undefined,
      geminiApiKey: 'gemini-demo-key',
      geminiModel: 'gemini-3.1-flash-lite-preview',
      obsidianFolder: 'Clippings',
      obsidianDynamicFolders: []
    } as never,
    {
      selectVideoSourceAdapter: () => ({ name: 'file' }),
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
        return '## Local Video（00:00）\n\nhello transcript'
      }
    }
  )

  const result = await tool.invoke({
    source: '/tmp/input.mp4',
    save: false,
    title: 'Local Video'
  })

  assert.equal(result.saved, false)
  assert.equal(result.provider_used, 'whisper_cpp')
  assert.match(result.transcript_markdown, /## Local Video（00:00）/)
  assert.match(result.transcript_markdown, /hello transcript/)
})

test('transcribe video tool should save transcript when enabled', async () => {
  let saveCalled = false
  const tool = createTranscribeVideoTool(
    {
      transcriptionProvider: 'whisper_cpp',
      transcriptionFallbackProvider: 'gemini',
      whisperCppBin: 'whisper-cli',
      whisperCppModelPath: '/models/base.bin',
      whisperCppLanguage: undefined,
      geminiApiKey: 'gemini-demo-key',
      geminiModel: 'gemini-3.1-flash-lite-preview',
      obsidianFolder: 'Clippings',
      obsidianDynamicFolders: []
    } as never,
    {
      selectVideoSourceAdapter: () => ({ name: 'file' }),
      resolveFileVideoSource: async (source) => ({
        adapter: 'file',
        sourceUrl: source,
        mediaPath: source
      }),
      extractAudioFromVideo: async () => '/tmp/audio.mp3',
      transcribeAudio: async () => ({
        providerUsed: 'gemini',
        text: 'saved transcript',
        srt: undefined,
        fallbackUsed: true
      }),
      buildTranscriptMarkdown: async ({ transcriptText }) => `## Saved Video\n\n${transcriptText}`,
      saveToObsidian: async (input) => {
        saveCalled = true
        assert.equal(input.title, 'Saved Video')
        assert.match(input.content_markdown, /saved transcript/)
        return {
          saved: true,
          path: 'Clippings/Saved Video.md'
        }
      }
    }
  )

  const result = await tool.invoke({
    source: '/tmp/input.mp4',
    save: true,
    title: 'Saved Video'
  })

  assert.equal(saveCalled, true)
  assert.equal(result.saved, true)
  assert.equal(result.path, 'Clippings/Saved Video.md')
})

test('transcribe video tool should pass Douyin cookie to resolver', async () => {
  let receivedCookieHeader: string | undefined
  const tool = createTranscribeVideoTool(
    {
      transcriptionProvider: 'whisper_cpp',
      transcriptionFallbackProvider: 'gemini',
      whisperCppBin: 'whisper-cli',
      whisperCppModelPath: '/models/base.bin',
      whisperCppLanguage: undefined,
      geminiApiKey: 'gemini-demo-key',
      geminiModel: 'gemini-3.1-flash-lite-preview',
      douyinCookie: 'ttwid=abc',
      obsidianFolder: 'Clippings',
      obsidianDynamicFolders: []
    } as never,
    {
      selectVideoSourceAdapter: () => ({ name: 'douyin' }),
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
      buildTranscriptMarkdown: async () => '## Douyin Video（00:00）\n\nhello transcript'
    }
  )

  const result = await tool.invoke({
    source: 'https://v.douyin.com/ABCDE/',
    save: false
  })

  assert.equal(receivedCookieHeader, 'ttwid=abc')
  assert.equal(result.saved, false)
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

test('extractJsonPayload should unwrap noisy model output around json', () => {
  assert.equal(
    __test__.extractJsonPayload('Using response format.\n```json\n{"title":"A","body":"B"}\n```'),
    '{"title":"A","body":"B"}'
  )
  assert.equal(
    __test__.extractJsonPayload('prefix [{"title":"A","startSeconds":0,"body":"B"}] suffix'),
    '[{"title":"A","startSeconds":0,"body":"B"}]'
  )
})

test('shouldTranslateToChinese should detect non-Chinese transcript', () => {
  assert.equal(
    __test__.shouldTranslateToChinese([
      {
        rawText: 'Now I have two hooks that I am going to put here on the screen.'
      }
    ]),
    true
  )

  assert.equal(
    __test__.shouldTranslateToChinese([
      {
        rawText: '这是中文内容，主要讲英语写作的钩子开头。'
      }
    ]),
    false
  )
})

test('pickGeminiSummarizeModel should route translation to pro preview', () => {
  assert.equal(__test__.pickGeminiSummarizeModel(true), 'gemini-3.1-pro-preview')
  assert.equal(__test__.pickGeminiSummarizeModel(false), 'gemini-3.1-flash-lite-preview')
})
