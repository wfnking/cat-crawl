type GeminiFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

type GenerateDescriptionOptions = {
  apiKey: string
  model?: string
  fetchImpl?: GeminiFetch
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return ''
  }
  const candidates = (
    payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  ).candidates
  if (!Array.isArray(candidates)) {
    return ''
  }
  return candidates
    .flatMap((item) => item.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim()
}

export async function generateDescriptionWithGemini(
  markdown: string,
  options: GenerateDescriptionOptions
): Promise<string> {
  const model = options.model || 'gemini-2.5-pro'
  const fetchImpl = options.fetchImpl || fetch
  const prompt = [
    'Summarize the main idea of the following content in one concise sentence.',
    'Use the same language as the content when possible.',
    'Do not include URLs, timestamps, source labels, title labels, or preamble.',
    'Return only the sentence.',
    '',
    markdown.slice(0, 6000)
  ].join('\n')

  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    )

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`status=${response.status} body=${detail}`)
    }

    const payload = (await response.json()) as unknown
    const text = extractGeminiText(payload)
    if (!text) {
      throw new Error('empty summary response')
    }
    return text
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Gemini description generation failed: ${detail}`)
  }
}
