import { execFileSync } from "node:child_process";
import { createHash, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

type ChromeCookieRow = {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Buffer;
  path: string;
  is_secure: number;
  is_httponly: number;
  expires_utc: number;
  samesite: number;
  last_access_utc: number;
};

export type ChromeCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number;
  sameSite?: "Lax" | "None" | "Strict";
};

type ChromeCookieDeps = {
  chromeRootDir?: string;
  safeStorageSecret?: string;
};

function getChromeRootDir(): string {
  return join(process.env.HOME || "", "Library", "Application Support", "Google", "Chrome");
}

function getChromeSafeStorageSecret(): string {
  return execFileSync("security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage", "-a", "Chrome"], {
    encoding: "utf8",
  }).trim();
}

function getChromeEncryptionKey(secret: string): Buffer {
  return pbkdf2Sync(Buffer.from(secret, "utf8"), Buffer.from("saltysalt", "utf8"), 1003, 16, "sha1");
}

function stripPadding(buffer: Buffer): Buffer {
  const pad = buffer[buffer.length - 1];
  if (!pad || pad > 16) {
    return buffer;
  }
  return buffer.subarray(0, buffer.length - pad);
}

function chromeTimestampToUnixSeconds(timestamp: number): number | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }
  const unixSeconds = Math.floor(timestamp / 1_000_000 - 11_644_473_600);
  return unixSeconds > 0 ? unixSeconds : undefined;
}

function mapSameSite(value: number): "Lax" | "None" | "Strict" | undefined {
  if (value === 1) {
    return "None";
  }
  if (value === 2) {
    return "Lax";
  }
  if (value === 3) {
    return "Strict";
  }
  return undefined;
}

function decryptChromeCookieValue(
  row: Pick<ChromeCookieRow, "host_key" | "value" | "encrypted_value">,
  key: Buffer,
): string {
  if (row.value) {
    return row.value;
  }
  if (!row.encrypted_value?.length) {
    return "";
  }

  const encrypted = row.encrypted_value;
  if (encrypted.subarray(0, 3).toString("utf8") !== "v10") {
    return encrypted.toString("utf8");
  }

  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  decipher.setAutoPadding(false);
  const decrypted = stripPadding(Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]));
  const hostDigest = createHash("sha256").update(row.host_key, "utf8").digest();
  if (decrypted.length >= 32 && decrypted.subarray(0, 32).equals(hostDigest)) {
    return decrypted.subarray(32).toString("utf8");
  }
  return decrypted.toString("utf8");
}

function copyChromeCookieDb(sourcePath: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), "cat-crawl-chrome-cookies-"));
  const targetPath = join(tempDir, "Cookies");
  cpSync(sourcePath, targetPath);
  const walPath = `${sourcePath}-wal`;
  const shmPath = `${sourcePath}-shm`;
  if (existsSync(walPath)) {
    cpSync(walPath, `${targetPath}-wal`);
  }
  if (existsSync(shmPath)) {
    cpSync(shmPath, `${targetPath}-shm`);
  }
  return targetPath;
}

function listChromeCookieDbPaths(chromeRootDir: string): string[] {
  if (!existsSync(chromeRootDir)) {
    return [];
  }

  return readdirSync(chromeRootDir)
    .filter((entry) => entry === "Default" || /^Profile \d+$/.test(entry))
    .map((entry) => join(chromeRootDir, entry, "Cookies"))
    .filter((cookieDbPath) => existsSync(cookieDbPath));
}

function selectBestCookieDb(cookieDbPaths: string[], domains: string[]): string | undefined {
  let bestPath: string | undefined;
  let bestLastAccessUtc = -1;

  for (const cookieDbPath of cookieDbPaths) {
    const copiedDbPath = copyChromeCookieDb(cookieDbPath);
    try {
      const db = new Database(copiedDbPath, { readonly: true, fileMustExist: true });
      const placeholders = domains.map(() => "?").join(", ");
      const row = db
        .prepare(
          `select max(last_access_utc) as last_access_utc from cookies where host_key in (${placeholders})`,
        )
        .get(...domains) as { last_access_utc: number | null };
      db.close();
      const lastAccessUtc = row.last_access_utc || -1;
      if (lastAccessUtc > bestLastAccessUtc) {
        bestLastAccessUtc = lastAccessUtc;
        bestPath = cookieDbPath;
      }
    } finally {
      rmSync(join(copiedDbPath, ".."), { recursive: true, force: true });
    }
  }

  return bestPath;
}

export function loadChromeCookiesForDomains(
  domains: string[],
  deps: ChromeCookieDeps = {},
): ChromeCookie[] {
  const normalizedDomains = Array.from(new Set(domains.map((item) => item.trim()).filter(Boolean)));
  if (normalizedDomains.length === 0) {
    return [];
  }

  const chromeRootDir = deps.chromeRootDir || getChromeRootDir();
  const cookieDbPaths = listChromeCookieDbPaths(chromeRootDir);
  if (cookieDbPaths.length === 0) {
    return [];
  }

  const selectedDbPath = selectBestCookieDb(cookieDbPaths, normalizedDomains);
  if (!selectedDbPath) {
    return [];
  }

  const copiedDbPath = copyChromeCookieDb(selectedDbPath);
  try {
    const db = new Database(copiedDbPath, { readonly: true, fileMustExist: true });
    const placeholders = normalizedDomains.map(() => "?").join(", ");
    const rows = db
      .prepare(
        [
          "select host_key, name, value, encrypted_value, path, is_secure, is_httponly,",
          "expires_utc, samesite, last_access_utc",
          `from cookies where host_key in (${placeholders})`,
          "order by last_access_utc desc",
        ].join(" "),
      )
      .all(...normalizedDomains) as ChromeCookieRow[];
    db.close();

    const secret = deps.safeStorageSecret || getChromeSafeStorageSecret();
    const key = getChromeEncryptionKey(secret);
    const cookies = rows
      .filter((row) => row.name.trim())
      .map((row) => ({
        name: row.name,
        value: decryptChromeCookieValue(row, key),
        domain: row.host_key,
        path: row.path || "/",
        secure: row.is_secure === 1,
        httpOnly: row.is_httponly === 1,
        expires: chromeTimestampToUnixSeconds(row.expires_utc),
        sameSite: mapSameSite(row.samesite),
      }))
      .filter((row) => row.value);

    const deduped = new Map<string, ChromeCookie>();
    for (const cookie of cookies) {
      const key = [cookie.domain, cookie.name, cookie.path].join("\t");
      if (!deduped.has(key)) {
        deduped.set(key, cookie);
      }
    }
    return Array.from(deduped.values());
  } finally {
    rmSync(join(copiedDbPath, ".."), { recursive: true, force: true });
  }
}

export const __test__ = {
  chromeTimestampToUnixSeconds,
  decryptChromeCookieValue,
  getChromeEncryptionKey,
  mapSameSite,
  stripPadding,
};
