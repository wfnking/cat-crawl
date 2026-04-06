import { execFile } from "node:child_process";
import { createLogger } from "@cat-crawl/core";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsyncDefault = promisify(execFile);
const logger = createLogger();

type ExecFileAsync = (
  file: string,
  args: string[],
  options?: { cwd?: string; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

type ReadFileAsync = (path: string, encoding: BufferEncoding) => Promise<string>;

type WhisperCppOptions = {
  bin: string;
  modelPath: string;
  language?: string;
  outputDir: string;
  execFileAsync?: ExecFileAsync;
  readFileAsync?: ReadFileAsync;
};

type WhisperCppResult = {
  provider: "whisper_cpp";
  text: string;
  srt: string;
};

function formatWhisperCommandForLog(bin: string, args: string[]): string {
  return [bin, ...args].join(" ").trim();
}

export async function transcribeWithWhisperCpp(
  audioPath: string,
  options: WhisperCppOptions,
): Promise<WhisperCppResult> {
  const execFileAsync = options.execFileAsync || execFileAsyncDefault;
  const readFileAsync = options.readFileAsync || readFile;
  const outputBase = join(options.outputDir, "transcript");
  const outputPath = `${outputBase}.txt`;
  const srtPath = `${outputBase}.srt`;
  const args = ["-f", audioPath, "-m", options.modelPath, "-otxt", "-osrt", "-of", outputBase];

  if (options.language?.trim()) {
    args.push("-l", options.language.trim());
  }

  await mkdir(options.outputDir, { recursive: true });
  logger.info(`[transcription:whisper_cpp] command=${formatWhisperCommandForLog(options.bin, args)}`);
  try {
    await execFileAsync(options.bin, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`[transcription:whisper_cpp] failed msg=${detail}`);
    throw new Error(`whisper.cpp failed: ${detail}`);
  }

  const text = (await readFileAsync(outputPath, "utf8")).trim();
  if (!text) {
    logger.error("[transcription:whisper_cpp] failed msg=empty transcript output");
    throw new Error("whisper.cpp failed: empty transcript output");
  }

  const srt = (await readFileAsync(srtPath, "utf8")).trim();
  if (!srt) {
    logger.error("[transcription:whisper_cpp] failed msg=empty srt output");
    throw new Error("whisper.cpp failed: empty srt output");
  }

  return {
    provider: "whisper_cpp",
    text,
    srt,
  };
}
