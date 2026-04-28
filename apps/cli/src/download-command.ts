export type DownloadCommand = {
  action: "download";
  input: string;
  tempRootDir?: string;
};

export function parseDownloadCommand(args: string[]): DownloadCommand | null {
  if (args[0]?.trim().toLowerCase() !== "download") {
    return null;
  }

  const rest = args.slice(1);
  let tempRootDir: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === "--data-dir" || a === "-d") {
      const v = rest[i + 1]?.trim();
      if (!v) {
        throw new Error("Usage: cat-crawl download [--data-dir|-d <path>] <URL 或文本>");
      }
      tempRootDir = v;
      i += 1;
      continue;
    }
    positional.push(a);
  }

  const input = positional.join(" ").trim();
  if (!input) {
    throw new Error('Usage: cat-crawl download [--data-dir|-d <path>] "<URL>"');
  }

  return tempRootDir !== undefined
    ? { action: "download", input, tempRootDir }
    : { action: "download", input };
}
