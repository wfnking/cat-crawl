import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsyncDefault = promisify(execFile);

export const youtubeVideoSourceAdapter = {
  name: "youtube",
} as const;

type ExecFileAsync = (
  file: string,
  args: string[],
  options?: { cwd?: string; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

type ResolveYouTubeVideoSourceOptions = {
  outputDir: string;
  execFileAsync?: ExecFileAsync;
};

type ResolvedYouTubeVideoSource = {
  adapter: "youtube";
  sourceUrl: string;
  mediaPath: string;
  title?: string;
};

function parseStdoutLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseDownloadedMediaPath(stdout: string, stderr: string): string {
  const stdoutLines = parseStdoutLines(stdout);
  if (stdoutLines.length >= 2) {
    return stdoutLines[stdoutLines.length - 1] || "";
  }
  if (stdoutLines.length > 0) {
    return stdoutLines[stdoutLines.length - 1] || "";
  }

  const stderrLines = stderr
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^warning:/i.test(line));
  return stderrLines[stderrLines.length - 1] || "";
}

function parseDownloadedTitle(stdout: string): string | undefined {
  const stdoutLines = parseStdoutLines(stdout);
  if (stdoutLines.length >= 2) {
    return stdoutLines[0] || undefined;
  }
  return undefined;
}

function isMissingYtDlpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("spawn yt-dlp ENOENT") || message.includes("yt-dlp: command not found");
}

export async function resolveYouTubeVideoSource(
  sourceUrl: string,
  options: ResolveYouTubeVideoSourceOptions,
): Promise<ResolvedYouTubeVideoSource> {
  await mkdir(options.outputDir, { recursive: true });

  const execFileAsync = options.execFileAsync || execFileAsyncDefault;
  const outputTemplate = join(options.outputDir, "video.%(ext)s");
  try {
    const { stdout, stderr } = await execFileAsync(
      "yt-dlp",
      ["--no-progress", "--print", "title", "--print", "after_move:filepath", "-o", outputTemplate, sourceUrl],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const title = parseDownloadedTitle(stdout);
    const mediaPath = parseDownloadedMediaPath(stdout, stderr);
    if (!mediaPath) {
      throw new Error("yt-dlp did not return a downloaded file path");
    }
    return {
      adapter: "youtube",
      sourceUrl,
      mediaPath,
      title,
    };
  } catch (error) {
    if (isMissingYtDlpError(error)) {
      throw new Error("yt-dlp not found. Please install `yt-dlp`.");
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`YouTube download failed: ${detail}`);
  }
}
