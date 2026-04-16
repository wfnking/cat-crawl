import { execFile } from "node:child_process";
import { createLogger } from "@cat-crawl/core";
import { mkdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
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

type WhisperCppSshOptions = {
  host: string;
  user?: string;
  port?: number;
  audioDir?: string;
  outputDir?: string;
};

type WhisperCppOptions = {
  bin: string;
  modelPath: string;
  language?: string;
  outputDir: string;
  ssh?: WhisperCppSshOptions;
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

function formatSshTarget(ssh: WhisperCppSshOptions): string {
  return ssh.user?.trim() ? `${ssh.user.trim()}@${ssh.host.trim()}` : ssh.host.trim();
}

function getRemoteAudioDir(ssh: WhisperCppSshOptions): string {
  return ssh.audioDir?.trim() || "/tmp/cat-crawl/audio";
}

function getRemoteOutputDir(ssh: WhisperCppSshOptions): string {
  return ssh.outputDir?.trim() || "/tmp/cat-crawl/whisper";
}

function buildSshArgs(ssh: WhisperCppSshOptions, command: string): string[] {
  const args = [] as string[];
  if (ssh.port) {
    args.push("-p", String(ssh.port));
  }
  args.push(formatSshTarget(ssh), command);
  return args;
}

function buildScpArgs(
  ssh: WhisperCppSshOptions,
  sources: string[],
  destination: string,
): string[] {
  const args = [] as string[];
  if (ssh.port) {
    args.push("-P", String(ssh.port));
  }
  args.push(...sources, destination);
  return args;
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
  if (options.ssh?.host?.trim()) {
    const ssh = options.ssh;
    const remoteAudioDir = getRemoteAudioDir(ssh);
    const remoteOutputDir = getRemoteOutputDir(ssh);
    const remoteAudioPath = `${remoteAudioDir}/${basename(audioPath)}`;
    const remoteOutputBase = `${remoteOutputDir}/transcript`;
    const remoteArgs = ["-f", remoteAudioPath, "-m", options.modelPath, "-otxt", "-osrt", "-of", remoteOutputBase];

    if (options.language?.trim()) {
      remoteArgs.push("-l", options.language.trim());
    }

    logger.info(
      `[transcription:whisper_cpp] ssh=${formatSshTarget(ssh)} remote_audio_dir=${remoteAudioDir} remote_output_dir=${remoteOutputDir}`,
    );
    logger.info(
      `[transcription:whisper_cpp] command=ssh ${formatSshTarget(ssh)} ${formatWhisperCommandForLog(options.bin, remoteArgs)}`,
    );
    try {
      await execFileAsync("ssh", buildSshArgs(ssh, `mkdir -p ${remoteAudioDir} ${remoteOutputDir}`), {
        maxBuffer: 10 * 1024 * 1024,
      });
      await execFileAsync("scp", buildScpArgs(ssh, [audioPath], `${formatSshTarget(ssh)}:${remoteAudioPath}`), {
        maxBuffer: 10 * 1024 * 1024,
      });
      await execFileAsync("ssh", buildSshArgs(ssh, formatWhisperCommandForLog(options.bin, remoteArgs)), {
        maxBuffer: 10 * 1024 * 1024,
      });
      await execFileAsync(
        "scp",
        buildScpArgs(
          ssh,
          [`${formatSshTarget(ssh)}:${remoteOutputBase}.txt`, `${formatSshTarget(ssh)}:${remoteOutputBase}.srt`],
          options.outputDir,
        ),
        { maxBuffer: 10 * 1024 * 1024 },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`[transcription:whisper_cpp] failed msg=${detail}`);
      throw new Error(`whisper.cpp failed: ${detail}`);
    }
  } else {
    logger.info(`[transcription:whisper_cpp] command=${formatWhisperCommandForLog(options.bin, args)}`);
    try {
      await execFileAsync(options.bin, args, { maxBuffer: 10 * 1024 * 1024 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`[transcription:whisper_cpp] failed msg=${detail}`);
      throw new Error(`whisper.cpp failed: ${detail}`);
    }
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
