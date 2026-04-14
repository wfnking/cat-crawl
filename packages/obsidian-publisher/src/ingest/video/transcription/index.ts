import { transcribeWithWhisperCpp } from "./whisper-cpp.js";
import { createLogger } from "@cat-crawl/core";

type ProviderName = "whisper_cpp";

type WhisperCppConfig = {
  bin: string;
  modelPath?: string;
  language?: string;
  outputDir?: string;
  ssh?: {
    host: string;
    user?: string;
    port?: number;
    audioDir?: string;
    outputDir?: string;
  };
};

type ProviderResult = {
  provider: ProviderName;
  text: string;
  srt?: string;
};

type TranscribeAudioOptions = {
  provider: ProviderName;
  whisperCpp: WhisperCppConfig;
  providers?: {
    whisperCpp?: (audioPath: string) => Promise<ProviderResult>;
  };
};

type TranscribeAudioResult = {
  providerUsed: ProviderName;
  text: string;
  srt?: string;
  fallbackUsed: boolean;
};

const logger = createLogger();

function createWhisperRunner(options: TranscribeAudioOptions): (audioPath: string) => Promise<ProviderResult> {
  return options.providers?.whisperCpp || ((audioPath: string) => {
    if (!options.whisperCpp.modelPath) {
      throw new Error("whisper.cpp failed: missing model path");
    }
    return transcribeWithWhisperCpp(audioPath, {
      bin: options.whisperCpp.bin,
      modelPath: options.whisperCpp.modelPath,
      language: options.whisperCpp.language,
      outputDir: options.whisperCpp.outputDir || "/tmp/cat-crawl/whisper",
      ssh: options.whisperCpp.ssh,
    });
  });
}

export async function transcribeAudio(
  audioPath: string,
  options: TranscribeAudioOptions,
): Promise<TranscribeAudioResult> {
  logger.info(`[transcription] start provider=${options.provider}`);
  const whisperRunner = createWhisperRunner(options);
  if (options.provider !== "whisper_cpp") {
    throw new Error(`Unsupported transcription provider: ${options.provider}`);
  }
  const result = await whisperRunner(audioPath);
  logger.info(`[transcription] success provider=${result.provider} fallback_used=false has_srt=${result.srt ? 1 : 0}`);
  return {
    providerUsed: result.provider,
    text: result.text,
    srt: result.srt,
    fallbackUsed: false,
  };
}
