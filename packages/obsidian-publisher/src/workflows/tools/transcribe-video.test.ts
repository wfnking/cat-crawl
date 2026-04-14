import assert from 'node:assert/strict'
import fs from 'node:fs'
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

test('transcribe video tool should default whisper language to Chinese', async () => {
  let receivedWhisperLanguage: string | undefined

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
      transcribeAudio: async (_audioPath, options) => {
        receivedWhisperLanguage = options.whisperCpp.language
        return {
          providerUsed: 'whisper_cpp',
          text: 'hello transcript',
          srt: undefined,
          fallbackUsed: false
        }
      },
      buildTranscriptMarkdown: async () => ({
        markdown: '## Local Video\n\nhello transcript'
      })
    }
  )

  await tool.invoke({
    source: '/tmp/input.mp4',
    title: 'Local Video'
  })

  assert.equal(receivedWhisperLanguage, 'zh')
})

test('transcribe video tool should pass whisper ssh config to transcription', async () => {
  let receivedWhisperSsh: {
    host: string
    user?: string
    port?: number
    audioDir?: string
    outputDir?: string
  } | undefined

  const tool = createTranscribeVideoTool(
    {
      transcriptionProvider: 'whisper_cpp',
      whisperCppBin: 'whisper-cli',
      whisperCppModelPath: '/models/base.bin',
      whisperCppLanguage: undefined,
      whisperCppSshHost: '192.168.10.16',
      whisperCppSshUser: 'alfwong',
      whisperCppSshPort: 22,
      whisperCppSshAudioDir: '/tmp/cat-crawl/audio',
      whisperCppSshOutputDir: '/tmp/cat-crawl/whisper',
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
      transcribeAudio: async (_audioPath, options) => {
        receivedWhisperSsh = options.whisperCpp.ssh
        return {
          providerUsed: 'whisper_cpp',
          text: 'hello transcript',
          srt: undefined,
          fallbackUsed: false
        }
      },
      buildTranscriptMarkdown: async () => ({
        markdown: '## Local Video\n\nhello transcript'
      })
    }
  )

  await tool.invoke({
    source: '/tmp/input.mp4',
    title: 'Local Video'
  })

  assert.deepEqual(receivedWhisperSsh, {
    host: '192.168.10.16',
    user: 'alfwong',
    port: 22,
    audioDir: '/tmp/cat-crawl/audio',
    outputDir: '/tmp/cat-crawl/whisper'
  })
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

test('transcribe video tool should append full transcript after structured markdown', async () => {
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
        text: 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five. Sentence six.',
        srt: undefined,
        fallbackUsed: false
      }),
      buildTranscriptMarkdown: async () => ({
        markdown: '## Summary\n\nShort structured recap.'
      })
    }
  )

  const result = await tool.invoke({
    source: '/tmp/input.mp4',
    title: 'Long Video'
  })

  assert.match(result.content_markdown, /## Summary/)
  assert.match(result.content_markdown, /## Full Transcript/)
  assert.match(result.content_markdown, /Sentence one\./)
  assert.match(result.content_markdown, /Sentence six\./)
})

test('transcribe video tool should not append full transcript for Chinese source text', async () => {
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
        text: '这是第一句。这是第二句。这是第三句。',
        srt: undefined,
        fallbackUsed: false
      }),
      buildTranscriptMarkdown: async () => ({
        markdown: '## 中文内容\n\n这是整理后的正文。'
      })
    }
  )

  const result = await tool.invoke({
    source: '/tmp/input.mp4',
    title: '中文视频'
  })

  assert.match(result.content_markdown, /## 中文内容/)
  assert.doesNotMatch(result.content_markdown, /## Full Transcript/)
  assert.doesNotMatch(result.content_markdown, /这是第一句。这是第二句。这是第三句。/)
})

test('transcribe video tool should pass Douyin cookie to resolver', async () => {
  let receivedCookieHeader: string | undefined
  let receivedOutputDir: string | undefined
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
        receivedOutputDir = options?.outputDir
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
  assert.equal(receivedOutputDir, '/tmp/cat-crawl/douyin')
  assert.equal(result.source_url, 'https://www.douyin.com/video/123456')
})

test('transcribe video tool should use unified temp directories under /tmp/cat-crawl', async () => {
  let receivedYoutubeOutputDir: string | undefined
  let receivedAudioOutputDir: string | undefined
  let receivedWhisperOutputDir: string | undefined
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
      selectVideoHandler: () => ({ name: 'youtube' }),
      resolveYouTubeVideoSource: async (_source, options) => {
        receivedYoutubeOutputDir = options?.outputDir
        return {
          adapter: 'youtube',
          sourceUrl: 'https://www.youtube.com/watch?v=abc123',
          mediaPath: '/tmp/cat-crawl/youtube/audio.webm',
          title: 'Demo Title'
        }
      },
      extractAudioFromVideo: async (_inputPath, options) => {
        receivedAudioOutputDir = options.outputDir
        return '/tmp/cat-crawl/audio/audio.mp3'
      },
      transcribeAudio: async (_audioPath, options) => {
        receivedWhisperOutputDir = options.whisperCpp.outputDir
        return {
          providerUsed: 'whisper_cpp',
          text: 'hello transcript',
          srt: undefined,
          fallbackUsed: false
        }
      },
      buildTranscriptMarkdown: async () => ({
        markdown: '## Summary\n\nhello transcript'
      })
    }
  )

  await tool.invoke({
    source: 'https://www.youtube.com/watch?v=abc123'
  })

  assert.equal(receivedYoutubeOutputDir, '/tmp/cat-crawl/youtube')
  assert.equal(receivedAudioOutputDir, '/tmp/cat-crawl/audio')
  assert.equal(receivedWhisperOutputDir, '/tmp/cat-crawl/whisper')
})

test('transcribe video tool should keep temp cache directories instead of deleting them', async () => {
  const originalRmSync = fs.rmSync
  const originalMkdirSync = fs.mkdirSync
  const mkdirCalls: string[] = []
  let rmCalls = 0

  fs.rmSync = (() => {
    rmCalls += 1
  }) as typeof fs.rmSync
  fs.mkdirSync = ((path: fs.PathLike) => {
    mkdirCalls.push(String(path))
    return path as fs.MakeDirectoryReturnType
  }) as typeof fs.mkdirSync

  try {
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
        selectVideoHandler: () => ({ name: 'youtube' }),
        resolveYouTubeVideoSource: async () => ({
          adapter: 'youtube',
          sourceUrl: 'https://www.youtube.com/watch?v=abc123',
          mediaPath: '/tmp/cat-crawl/youtube/audio.webm',
          title: 'Demo Title'
        }),
        extractAudioFromVideo: async () => '/tmp/cat-crawl/audio/audio.mp3',
        transcribeAudio: async () => ({
          providerUsed: 'whisper_cpp',
          text: 'hello transcript',
          srt: undefined,
          fallbackUsed: false
        }),
        buildTranscriptMarkdown: async () => ({
          markdown: '## Summary\n\nhello transcript'
        })
      }
    )

    await tool.invoke({
      source: 'https://www.youtube.com/watch?v=abc123'
    })
  } finally {
    fs.rmSync = originalRmSync
    fs.mkdirSync = originalMkdirSync
  }

  assert.equal(rmCalls, 0)
  assert.deepEqual(mkdirCalls, [
    '/tmp/cat-crawl/youtube',
    '/tmp/cat-crawl/douyin',
    '/tmp/cat-crawl/audio',
    '/tmp/cat-crawl/whisper'
  ])
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

test('shouldTranslateToChinese should keep Chinese transcript monolingual when English translation is mixed in', () => {
  assert.equal(
    __test__.shouldTranslateToChinese(
      [
        '2026做自媒体一定要有长期价值，做深度内容，不要害怕做长视频没人看。',
        "In 2026, if you're doing self-media, you must have long-term value and create in-depth content.",
        '所以视频时长和完播是不会影响你视频流量的。',
        "Therefore, video length and completion rate do not affect your video's traffic."
      ].join('\n\n')
    ),
    false
  )
})

test('pickGeminiSummarizeModel should route translation to pro preview', () => {
  assert.equal(__test__.pickGeminiSummarizeModel({ geminiModel: 'gemini-2.5-pro' } as any, true), 'gemini-2.5-pro')
  assert.equal(__test__.pickGeminiSummarizeModel({ geminiModel: 'gemini-2.5-pro' } as any, false), 'gemini-2.5-pro')
})

test('pickSummarizeModel should use openai-compatible model for deepseek provider', () => {
  assert.equal(
    __test__.pickSummarizeModel(
      { geminiModel: 'gemini-2.5-pro', openaiModel: 'deepseek-chat' } as any,
      'deepseek',
      false
    ),
    'deepseek-chat'
  )
})

test('pickTranscriptSourceMaterial should prefer plain transcript over verbose srt', () => {
  assert.equal(
    __test__.pickTranscriptSourceMaterial({
      transcriptText: 'plain transcript text',
      transcriptSrt: '1\n00:00:00,000 --> 00:00:02,000\nplain transcript text\n'
    }),
    'plain transcript text'
  )
})

test('buildTranscriptSystemPrompt should not request English translation for Chinese source', () => {
  const prompt = __test__.buildTranscriptSystemPrompt({
    sourceUrl: 'https://example.com/video',
    translateToChinese: false
  })

  assert.match(prompt, /如果原文已经是中文，只保留中文整理稿，不要翻译成英文/)
  assert.doesNotMatch(prompt, /紧接着写对应的中文翻译内容/)
  assert.match(prompt, /每章只写原始语言内容（保真整理，轻微断句即可）/)
})

test('buildTranscriptSystemPrompt should request Chinese translation for non-Chinese source', () => {
  const prompt = __test__.buildTranscriptSystemPrompt({
    sourceUrl: 'https://example.com/video',
    translateToChinese: true
  })

  assert.match(prompt, /每章先写原始语言内容（保真整理，轻微断句即可），紧接着写对应的中文翻译内容/)
  assert.match(prompt, /若内容过长，优先确保原文完整输出；译文可以按段落精炼翻译/)
})
