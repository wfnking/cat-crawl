import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getHistoryStore, type HistoryStore, type SuccessRecord } from "../history/history-store.js";

const execFileAsync = promisify(execFile);

type ObsidianFileLookup = (vault: string, path: string) => Promise<string>;

export type ExistingSavedRecord = Pick<
  SuccessRecord,
  "createdAt" | "title" | "vault" | "path" | "sourceUrl"
>;

function parseObsidianLookupOutput(output: string): boolean {
  const text = output.toLowerCase();
  if (text.includes("error:")) {
    return false;
  }
  if (text.includes("not found")) {
    return false;
  }
  return text.includes("path\t");
}

async function defaultLookup(vault: string, path: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    "obsidian",
    [`vault=${vault}`, "file", `path=${path}`],
    { maxBuffer: 5 * 1024 * 1024 },
  );
  return [stdout, stderr].filter(Boolean).join("\n");
}

export async function findExistingSavedRecordByUrl(
  sourceUrl: string,
  options?: {
    store?: HistoryStore;
    lookup?: ObsidianFileLookup;
  },
): Promise<ExistingSavedRecord | null> {
  const normalizedUrl = sourceUrl.trim();
  if (!normalizedUrl) {
    return null;
  }

  const store = options?.store || getHistoryStore();
  const record = store.findLatestSuccessBySourceUrl(normalizedUrl);
  if (!record) {
    return null;
  }

  const lookup = options?.lookup || defaultLookup;
  try {
    const output = await lookup(record.vault, record.path);
    if (!parseObsidianLookupOutput(output)) {
      return null;
    }
    return {
      createdAt: record.createdAt,
      title: record.title,
      vault: record.vault,
      path: record.path,
      sourceUrl: record.sourceUrl,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[agent] existing-note check failed, fallback to normal crawl: ${detail}`);
    return null;
  }
}
