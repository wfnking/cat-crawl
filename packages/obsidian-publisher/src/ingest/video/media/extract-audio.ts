import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsyncDefault = promisify(execFile);

type ExecFileAsync = (
  file: string,
  args: string[],
  options?: { cwd?: string; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

type StatAsync = (path: string) => Promise<{ size: number }>;

type ExtractAudioOptions = {
  outputDir: string;
  execFileAsync?: ExecFileAsync;
  statAsync?: StatAsync;
};

function isMissingFfmpegError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("spawn ffmpeg ENOENT") || message.includes("ffmpeg: command not found");
}

function buildAudioOutputPath(inputPath: string, outputDir: string): string {
  const sourceBase = basename(inputPath, extname(inputPath)).trim();
  const normalized = sourceBase
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return join(outputDir, `${normalized || "audio"}.mp3`);
}

export async function extractAudioFromVideo(
  inputPath: string,
  options: ExtractAudioOptions,
): Promise<string> {
  const execFileAsync = options.execFileAsync || execFileAsyncDefault;
  const statAsync = options.statAsync || stat;
  const outputPath = buildAudioOutputPath(inputPath, options.outputDir);

  await mkdir(options.outputDir, { recursive: true });
  try {
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", outputPath],
      { maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (error) {
    if (isMissingFfmpegError(error)) {
      throw new Error("ffmpeg not found. Please install `ffmpeg`.");
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Audio extraction failed: ${detail}`);
  }

  const outputStat = await statAsync(outputPath);
  if (!outputStat.size) {
    throw new Error("Extracted audio file is empty.");
  }
  return outputPath;
}
