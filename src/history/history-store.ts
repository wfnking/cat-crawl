import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type HistoryChannel = "cli" | "feishu" | "telegram" | "discord";
export type HistorySource = "wechat" | "x" | "unknown";
export type QueryScope = "all" | "today";

export type SuccessRecordInput = {
  createdAt: string;
  source: HistorySource;
  channel: HistoryChannel;
  sourceUrl: string;
  title: string;
  tags: string[];
  vault: string;
  path: string;
  dynamicFolder?: string;
  author?: string;
  senderId?: string;
  roomId?: string;
  messageId?: string;
};

export type SuccessRecord = SuccessRecordInput & {
  id: number;
};

export type QuerySuccessRecordsInput = {
  scope: QueryScope;
  tag?: string;
  limit?: number;
};

export type QuerySuccessRecordsResult = {
  total: number;
  items: SuccessRecord[];
};

export type HistoryStore = {
  insertSuccessRecord: (record: SuccessRecordInput) => void;
  querySuccessRecords: (input: QuerySuccessRecordsInput) => QuerySuccessRecordsResult;
  close: () => void;
};

type DbRow = {
  id: number;
  created_at: string;
  source: string;
  channel: string;
  source_url: string;
  title: string;
  tags_json: string;
  vault: string;
  path: string;
  dynamic_folder: string | null;
  author: string | null;
  sender_id: string | null;
  room_id: string | null;
  message_id: string | null;
};

const DEFAULT_DB_DIR = join(homedir(), ".cat-crawl");
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, "history.db");
const require = createRequire(import.meta.url);

function openDatabase(dbPath: string): import("node:sqlite").DatabaseSync {
  const sqlite = require("node:sqlite") as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(dbPath);
}

function createSchema(db: import("node:sqlite").DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS success_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL,
      channel TEXT NOT NULL,
      source_url TEXT NOT NULL,
      title TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      vault TEXT NOT NULL,
      path TEXT NOT NULL,
      dynamic_folder TEXT,
      author TEXT,
      sender_id TEXT,
      room_id TEXT,
      message_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_success_created_at ON success_records(created_at);
    CREATE INDEX IF NOT EXISTS idx_success_source ON success_records(source);
    CREATE INDEX IF NOT EXISTS idx_success_channel ON success_records(channel);
  `);
}

function toStartAndEndOfToday(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function parseTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function mapRow(row: DbRow): SuccessRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    source: (row.source === "wechat" || row.source === "x" ? row.source : "unknown") as HistorySource,
    channel: (
      row.channel === "cli" ||
      row.channel === "feishu" ||
      row.channel === "telegram" ||
      row.channel === "discord"
        ? row.channel
        : "cli"
    ) as HistoryChannel,
    sourceUrl: row.source_url,
    title: row.title,
    tags: parseTags(row.tags_json),
    vault: row.vault,
    path: row.path,
    dynamicFolder: row.dynamic_folder ?? undefined,
    author: row.author ?? undefined,
    senderId: row.sender_id ?? undefined,
    roomId: row.room_id ?? undefined,
    messageId: row.message_id ?? undefined,
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit) {
    return 20;
  }
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function hasTag(record: SuccessRecord, tag: string): boolean {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return record.tags.some((item) => item.toLowerCase() === normalized);
}

export function createHistoryStore(options?: { dbPath?: string }): HistoryStore {
  const dbPath = options?.dbPath || DEFAULT_DB_PATH;
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  createSchema(db);

  const insertStmt = db.prepare(`
    INSERT INTO success_records (
      created_at, source, channel, source_url, title, tags_json,
      vault, path, dynamic_folder, author, sender_id, room_id, message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return {
    insertSuccessRecord(record) {
      insertStmt.run(
        record.createdAt,
        record.source,
        record.channel,
        record.sourceUrl,
        record.title,
        JSON.stringify(record.tags),
        record.vault,
        record.path,
        record.dynamicFolder ?? null,
        record.author ?? null,
        record.senderId ?? null,
        record.roomId ?? null,
        record.messageId ?? null,
      );
    },
    querySuccessRecords(input) {
      const limit = normalizeLimit(input.limit);
      const conditions: string[] = [];
      const values: string[] = [];

      if (input.scope === "today") {
        const { start, end } = toStartAndEndOfToday();
        conditions.push("created_at >= ?", "created_at < ?");
        values.push(start, end);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const stmt = db.prepare(`
        SELECT id, created_at, source, channel, source_url, title, tags_json,
               vault, path, dynamic_folder, author, sender_id, room_id, message_id
        FROM success_records
        ${whereClause}
        ORDER BY created_at DESC
      `);

      const rows = stmt.all(...values) as DbRow[];
      let items = rows.map(mapRow);

      if (input.tag?.trim()) {
        items = items.filter((item) => hasTag(item, input.tag || ""));
      }

      return {
        total: items.length,
        items: items.slice(0, limit),
      };
    },
    close() {
      db.close();
    },
  };
}

let singletonStore: HistoryStore | null = null;

export function getHistoryStore(): HistoryStore {
  if (!singletonStore) {
    singletonStore = createHistoryStore();
  }
  return singletonStore;
}

export function inferSourceFromUrl(url: string): HistorySource {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("weixin.qq.com")) {
      return "wechat";
    }
    if (host.includes("x.com") || host.includes("twitter.com")) {
      return "x";
    }
  } catch {
    // ignore
  }
  return "unknown";
}
