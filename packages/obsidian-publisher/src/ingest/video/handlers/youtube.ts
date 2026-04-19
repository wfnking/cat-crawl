import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsyncDefault = promisify(execFile);

export const youtubeVideoHandler = {
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
  transcriptPath?: string;
  title?: string;
  published?: string;
  author?: string;
};

function sanitizeMediaFileName(input: string): string {
  return input
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/g, "")
    .slice(0, 120)
    .trim();
}

function parseMetadataOutput(stdout: string): {
  published: string | undefined;
  author: string | undefined;
  title: string | undefined;
} {
  const meta: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/g)) {
    const match = line.match(/^(published|author|title):(.*)$/);
    if (match) {
      meta[match[1]!] = match[2]!.trim();
    }
  }

  const raw = meta["published"] ?? "";
  let published: string | undefined;
  if (/^\d{8}$/.test(raw)) {
    published = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  const author = meta["author"] || undefined;
  const title = meta["title"] || undefined;

  return { published, author, title };
}

function parseDownloadedMediaPath(stdout: string, stderr: string): string {
  const stdoutLines = stdout.split(/\r?\n/g).map((l) => l.trim()).filter(Boolean);
  let mediaPath = stdoutLines[stdoutLines.length - 1] ?? "";
  if (!mediaPath) {
    const stderrLines = stderr
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^warning:/i.test(l));
    mediaPath = stderrLines[stderrLines.length - 1] ?? "";
  }
  return mediaPath;
}

function parseDownloadedSubtitlePath(stdout: string, stderr: string): string | undefined {
  const combined = `${stdout}\n${stderr}`;
  for (const line of combined.split(/\r?\n/g)) {
    const match = line.match(/Writing video subtitles to:\s*(.+\.srt)\s*$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function getExecErrorOutput(error: unknown): { stdout: string; stderr: string } {
  const maybeOutput = error as { stdout?: unknown; stderr?: unknown };
  return {
    stdout: typeof maybeOutput.stdout === "string" ? maybeOutput.stdout : "",
    stderr: typeof maybeOutput.stderr === "string" ? maybeOutput.stderr : "",
  };
}

function isMissingYtDlpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("spawn yt-dlp ENOENT") || message.includes("yt-dlp: command not found");
}

function isBrowserCookieExtractionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /cookies-from-browser/i.test(message) ||
    /extract cookies from chrome/i.test(message) ||
    /could not extract cookies from chrome/i.test(message) ||
    /could not copy chrome cookie database/i.test(message)
  );
}

function buildYtDlpArgs(sourceUrl: string, outputTemplate: string, useBrowserCookies: boolean): string[] {
  return [
    "--no-progress",
    ...(useBrowserCookies ? ["--cookies-from-browser", "chrome"] : []),
    "-f",
    "bestaudio/best",
    "--print",
    "published:%(upload_date)s",
    "--print",
    "author:%(uploader)s",
    "--print",
    "title:%(title)s",
    "--print",
    "after_move:filepath",
    "-o",
    outputTemplate,
    sourceUrl,
  ];
}

function buildYtDlpSubtitleArgs(sourceUrl: string, outputTemplate: string, useBrowserCookies: boolean): string[] {
  return [
    "--no-progress",
    ...(useBrowserCookies ? ["--cookies-from-browser", "chrome"] : []),
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    "en,en-orig,zh-Hans,zh-Hant",
    "--sub-format",
    "srt",
    "-o",
    outputTemplate,
    sourceUrl,
  ];
}

function buildYtDlpMetadataArgs(sourceUrl: string): string[] {
  return [
    "--no-progress",
    "--skip-download",
    "--print",
    "published:%(upload_date)s",
    "--print",
    "author:%(uploader)s",
    "--print",
    "title:%(title)s",
    sourceUrl,
  ];
}

async function tryDownloadSubtitle(
  execFileAsync: ExecFileAsync,
  sourceUrl: string,
  outputTemplate: string,
): Promise<string | undefined> {
  let subtitleStdout = "";
  let subtitleStderr = "";
  try {
    ({ stdout: subtitleStdout, stderr: subtitleStderr } = await execFileAsync(
      "yt-dlp",
      buildYtDlpSubtitleArgs(sourceUrl, outputTemplate, true),
      { maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch (error) {
    const partialPath = parseDownloadedSubtitlePath(
      getExecErrorOutput(error).stdout,
      getExecErrorOutput(error).stderr,
    );
    if (partialPath) {
      return partialPath;
    }
    if (!isBrowserCookieExtractionError(error)) {
      return undefined;
    }
    try {
      ({ stdout: subtitleStdout, stderr: subtitleStderr } = await execFileAsync(
        "yt-dlp",
        buildYtDlpSubtitleArgs(sourceUrl, outputTemplate, false),
        { maxBuffer: 10 * 1024 * 1024 },
      ));
    } catch (fallbackError) {
      const fallbackPartialPath = parseDownloadedSubtitlePath(
        getExecErrorOutput(fallbackError).stdout,
        getExecErrorOutput(fallbackError).stderr,
      );
      if (fallbackPartialPath) {
        return fallbackPartialPath;
      }
      return undefined;
    }
  }

  return parseDownloadedSubtitlePath(subtitleStdout, subtitleStderr);
}

export async function resolveYouTubeVideoSource(
  sourceUrl: string,
  options: ResolveYouTubeVideoSourceOptions,
): Promise<ResolvedYouTubeVideoSource> {
  await mkdir(options.outputDir, { recursive: true });

  const execFileAsync = options.execFileAsync || execFileAsyncDefault;
  try {
    const metadataResult = await execFileAsync(
      "yt-dlp",
      buildYtDlpMetadataArgs(sourceUrl),
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const { published, author, title } = parseMetadataOutput(metadataResult.stdout);
    const preferredBaseName = sanitizeMediaFileName(title || "") || "%(title)s";
    const outputTemplate = join(options.outputDir, `${preferredBaseName}.%(ext)s`);
    const transcriptPath = await tryDownloadSubtitle(
      execFileAsync,
      sourceUrl,
      outputTemplate,
    );
    if (transcriptPath) {
      return {
        adapter: "youtube",
        sourceUrl,
        mediaPath: transcriptPath,
        transcriptPath,
        title,
        published,
        author,
      };
    }

    let downloadStdout = "";
    let downloadStderr = "";
    try {
      ({ stdout: downloadStdout, stderr: downloadStderr } = await execFileAsync(
        "yt-dlp",
        buildYtDlpArgs(sourceUrl, outputTemplate, true),
        { maxBuffer: 10 * 1024 * 1024 },
      ));
    } catch (error) {
      if (!isBrowserCookieExtractionError(error)) {
        throw error;
      }
      ({ stdout: downloadStdout, stderr: downloadStderr } = await execFileAsync(
        "yt-dlp",
        buildYtDlpArgs(sourceUrl, outputTemplate, false),
        { maxBuffer: 10 * 1024 * 1024 },
      ));
    }
    const mediaPath = parseDownloadedMediaPath(downloadStdout, downloadStderr);
    if (!mediaPath || mediaPath === "NA") {
      // yt-dlp outputs "NA" when download failed (e.g. n challenge error)
      // extract the actual error from stderr for a useful message
      const stderrHint = downloadStderr
        .split(/\r?\n/g)
        .map((l) => l.trim())
        .filter((l) => /^error:/i.test(l))
        .at(0);
      throw new Error(
        stderrHint
          ? `yt-dlp download failed: ${stderrHint}`
          : "yt-dlp did not download the file. Check that yt-dlp is up to date (`yt-dlp -U`).",
      );
    }
    return {
      adapter: "youtube",
      sourceUrl,
      mediaPath,
      title,
      published,
      author,
    };
  } catch (error) {
    if (isMissingYtDlpError(error)) {
      throw new Error("yt-dlp not found. Please install `yt-dlp`.");
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`YouTube download failed: ${detail}`);
  }
}
