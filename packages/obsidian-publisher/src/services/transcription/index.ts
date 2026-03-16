import { transcribeWithGemini } from "./gemini.js";
import { transcribeWithWhisperCpp } from "./whisper-cpp.js";

type ProviderName = "whisper_cpp" | "gemini";

type WhisperCppConfig = {
  bin: string;
  modelPath?: string;
  language?: string;
  outputDir?: string;
};

type GeminiConfig = {
  apiKey?: string;
  model?: string;
};

type ProviderResult = {
  provider: ProviderName;
  text: string;
};

type TranscribeAudioOptions = {
  provider: ProviderName;
  fallbackProvider?: ProviderName;
  forceProvider?: boolean;
  whisperCpp: WhisperCppConfig;
  gemini?: GeminiConfig;
  providers?: {
    whisperCpp?: (audioPath: string) => Promise<ProviderResult>;
    gemini?: (audioPath: string) => Promise<ProviderResult>;
  };
};

type TranscribeAudioResult = {
  providerUsed: ProviderName;
  text: string;
  fallbackUsed: boolean;
};

function createWhisperRunner(options: TranscribeAudioOptions): (audioPath: string) => Promise<ProviderResult> {
  return options.providers?.whisperCpp || ((audioPath: string) => {
    if (!options.whisperCpp.modelPath) {
      throw new Error("whisper.cpp failed: missing model path");
    }
    return transcribeWithWhisperCpp(audioPath, {
      bin: options.whisperCpp.bin,
      modelPath: options.whisperCpp.modelPath,
      language: options.whisperCpp.language,
      outputDir: options.whisperCpp.outputDir || "/tmp/cat-crawl-whisper",
    });
  });
}

function createGeminiRunner(options: TranscribeAudioOptions): ((audioPath: string) => Promise<ProviderResult>) | null {
  if (options.providers?.gemini) {
    return options.providers.gemini;
  }
  if (!options.gemini?.apiKey) {
    return null;
  }
  return (audioPath: string) =>
    transcribeWithGemini(audioPath, {
      apiKey: options.gemini?.apiKey || "",
      model: options.gemini?.model,
    });
}

export async function transcribeAudio(
  audioPath: string,
  options: TranscribeAudioOptions,
): Promise<TranscribeAudioResult> {
  const whisperRunner = createWhisperRunner(options);
  const geminiRunner = createGeminiRunner(options);
  const runProvider = async (provider: ProviderName): Promise<ProviderResult> => {
    if (provider === "whisper_cpp") {
      return whisperRunner(audioPath);
    }
    if (!geminiRunner) {
      throw new Error("Gemini fallback is not configured.");
    }
    return geminiRunner(audioPath);
  };

  try {
    const primary = await runProvider(options.provider);
    return {
      providerUsed: primary.provider,
      text: primary.text,
      fallbackUsed: false,
    };
  } catch (error) {
    if (options.forceProvider || !options.fallbackProvider || options.fallbackProvider === options.provider) {
      throw error;
    }
    const fallback = await runProvider(options.fallbackProvider);
    return {
      providerUsed: fallback.provider,
      text: fallback.text,
      fallbackUsed: true,
    };
  }
}
