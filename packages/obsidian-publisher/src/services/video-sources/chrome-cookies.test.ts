import assert from "node:assert/strict";
import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { __test__, loadChromeCookiesForDomains } from "./chrome-cookies.js";

function createChromeCookieFixture(secret: string, hostKey: string, value: string): Buffer {
  const key = pbkdf2Sync(Buffer.from(secret, "utf8"), Buffer.from("saltysalt", "utf8"), 1003, 16, "sha1");
  const prefix = Buffer.from("v10", "utf8");
  const plain = Buffer.concat([createHash("sha256").update(hostKey, "utf8").digest(), Buffer.from(value, "utf8")]);
  const pad = 16 - (plain.length % 16 || 16);
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  cipher.setAutoPadding(false);
  return Buffer.concat([prefix, cipher.update(padded), cipher.final()]);
}

test("decryptChromeCookieValue should remove host digest for schema v24 cookies", () => {
  const secret = "demo-secret";
  const hostKey = ".douyin.com";
  const encrypted = createChromeCookieFixture(secret, hostKey, "cookie-value");
  const key = __test__.getChromeEncryptionKey(secret);

  const value = __test__.decryptChromeCookieValue(
    {
      host_key: hostKey,
      value: "",
      encrypted_value: encrypted,
    },
    key,
  );

  assert.equal(value, "cookie-value");
});

test("loadChromeCookiesForDomains should read and decrypt cookies from the newest Chrome profile", () => {
  const chromeRootDir = mkdtempSync(join(tmpdir(), "cat-crawl-chrome-root-"));
  const profileDir = join(chromeRootDir, "Profile 3");
  mkdirSync(profileDir, { recursive: true });
  const dbPath = join(profileDir, "Cookies");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE cookies(
      creation_utc INTEGER NOT NULL,
      host_key TEXT NOT NULL,
      top_frame_site_key TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      encrypted_value BLOB NOT NULL,
      path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL,
      last_access_utc INTEGER NOT NULL,
      has_expires INTEGER NOT NULL,
      is_persistent INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      samesite INTEGER NOT NULL,
      source_scheme INTEGER NOT NULL,
      source_port INTEGER NOT NULL,
      last_update_utc INTEGER NOT NULL,
      source_type INTEGER NOT NULL,
      has_cross_site_ancestor INTEGER NOT NULL
    );
  `);
  const encryptedValue = createChromeCookieFixture("demo-secret", ".douyin.com", "cookie-value");
  const expiresUtc = 13_500_000_000_000_000;
  db.prepare(`
    INSERT INTO cookies (
      creation_utc, host_key, top_frame_site_key, name, value, encrypted_value, path,
      expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent,
      priority, samesite, source_scheme, source_port, last_update_utc, source_type, has_cross_site_ancestor
    ) VALUES (?, ?, '', ?, '', ?, '/', ?, 1, 0, ?, 1, 1, 1, 2, 1, 443, ?, 1, 0)
  `).run(
    0,
    ".douyin.com",
    "ttwid",
    encryptedValue,
    13_418_148_247_540_040,
    expiresUtc,
    13_418_148_247_540_040,
  );
  db.close();

  try {
    const cookies = loadChromeCookiesForDomains([".douyin.com"], {
      chromeRootDir,
      safeStorageSecret: "demo-secret",
    });

    assert.equal(cookies.length, 1);
    assert.equal(cookies[0]?.name, "ttwid");
    assert.equal(cookies[0]?.value, "cookie-value");
    assert.equal(cookies[0]?.domain, ".douyin.com");
    assert.equal(cookies[0]?.path, "/");
    assert.equal(cookies[0]?.secure, true);
    assert.equal(cookies[0]?.httpOnly, false);
    assert.equal(cookies[0]?.sameSite, "Lax");
    assert.equal(typeof cookies[0]?.expires, "number");
    assert.ok((cookies[0]?.expires || 0) > 0);
  } finally {
    rmSync(chromeRootDir, { recursive: true, force: true });
  }
});
