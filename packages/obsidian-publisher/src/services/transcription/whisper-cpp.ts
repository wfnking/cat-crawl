import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsyncDefault = promisify(execFile);

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
};

export async function transcribeWithWhisperCpp(
  audioPath: string,
  options: WhisperCppOptions,
): Promise<WhisperCppResult> {
  const execFileAsync = options.execFileAsync || execFileAsyncDefault;
  const readFileAsync = options.readFileAsync || readFile;
  const outputBase = join(options.outputDir, "transcript");
  const outputPath = `${outputBase}.txt`;
  const args = ["-f", audioPath, "-m", options.modelPath, "-otxt", "-of", outputBase];

  if (options.language?.trim()) {
    args.push("-l", options.language.trim());
  }

  await mkdir(options.outputDir, { recursive: true });
  try {
    await execFileAsync(options.bin, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`whisper.cpp failed: ${detail}`);
  }

  const text = (await readFileAsync(outputPath, "utf8")).trim();
  if (!text) {
    throw new Error("whisper.cpp failed: empty transcript output");
  }

  return {
    provider: "whisper_cpp",
    text,
  };
}
