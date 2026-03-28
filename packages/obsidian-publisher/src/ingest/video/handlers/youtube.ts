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
  title?: string;
  published?: string;
  author?: string;
};

function parseYtDlpOutput(stdout: string, stderr: string): {
  published: string | undefined;
  author: string | undefined;
  title: string | undefined;
  mediaPath: string;
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

  // filepath is always the last line, same as original behavior
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

  return { published, author, title, mediaPath };
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
  const outputTemplate = join(options.outputDir, "audio.%(ext)s");
  try {
    const { stdout, stderr } = await execFileAsync(
      "yt-dlp",
      [
        "--no-progress",
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
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const { published, author, title, mediaPath } = parseYtDlpOutput(stdout, stderr);
    if (!mediaPath || mediaPath === "NA") {
      // yt-dlp outputs "NA" when download failed (e.g. n challenge error)
      // extract the actual error from stderr for a useful message
      const stderrHint = stderr
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
