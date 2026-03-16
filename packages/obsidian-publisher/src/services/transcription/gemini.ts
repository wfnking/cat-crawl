import { readFile } from "node:fs/promises";

type GeminiFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ReadFileAsync = (path: string) => Promise<Buffer>;

type GeminiOptions = {
  apiKey: string;
  model?: string;
  readFileAsync?: ReadFileAsync;
  fetchImpl?: GeminiFetch;
};

type GeminiResult = {
  provider: "gemini";
  text: string;
};

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates;
  if (!Array.isArray(candidates)) {
    return "";
  }
  return candidates
    .flatMap((item) => item.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
}

export async function transcribeWithGemini(
  audioPath: string,
  options: GeminiOptions,
): Promise<GeminiResult> {
  const model = options.model || "gemini-3-flash-preview";
  const readFileAsync = options.readFileAsync || readFile;
  const fetchImpl = options.fetchImpl || fetch;

  try {
    const audioBuffer = await readFileAsync(audioPath);
    const base64Audio = audioBuffer.toString("base64");
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
      `?key=${encodeURIComponent(options.apiKey)}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "audio/mpeg",
                  data: base64Audio,
                },
              },
              {
                text: "Generate a transcript of the speech in this audio.",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`status=${response.status} body=${detail}`);
    }

    const payload = (await response.json()) as unknown;
    const text = extractGeminiText(payload);
    if (!text) {
      throw new Error("empty transcript response");
    }

    return {
      provider: "gemini",
      text,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Gemini transcription failed: ${detail}`);
  }
}
