import { getLocalConfigStore } from "./local-config.js";

type PendingCodeRecord = {
  userId: string;
  createdAt: string;
};

type TelegramPairingConfig = {
  approvedUserIds?: string[];
  pendingCodes?: Record<string, PendingCodeRecord>;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = asObject(parent[key]);
  if (existing) {
    return existing;
  }
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

function readTelegramPairingConfig(raw: Record<string, unknown>): TelegramPairingConfig {
  const channels = asObject(raw.channels) || {};
  const telegram = asObject(channels.telegram) || {};
  const pairing = asObject(telegram.pairing) || {};

  const approvedUserIds = Array.isArray(pairing.approvedUserIds)
    ? pairing.approvedUserIds.filter((item): item is string => typeof item === "string")
    : [];

  const pendingCodesRaw = asObject(pairing.pendingCodes) || {};
  const pendingCodes: Record<string, PendingCodeRecord> = {};
  for (const [code, value] of Object.entries(pendingCodesRaw)) {
    const item = asObject(value);
    const userId = item?.userId;
    const createdAt = item?.createdAt;
    if (typeof userId === "string" && typeof createdAt === "string") {
      pendingCodes[code] = { userId, createdAt };
    }
  }

  return { approvedUserIds, pendingCodes };
}

function writeTelegramPairingConfig(
  raw: Record<string, unknown>,
  config: TelegramPairingConfig,
): Record<string, unknown> {
  const channels = ensureObject(raw, "channels");
  const telegram = ensureObject(channels, "telegram");
  const pairing = ensureObject(telegram, "pairing");
  pairing.approvedUserIds = config.approvedUserIds || [];
  pairing.pendingCodes = config.pendingCodes || {};
  return raw;
}

function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function isTelegramUserApproved(userId: string): boolean {
  const raw = getLocalConfigStore().readRaw();
  const cfg = readTelegramPairingConfig(raw);
  return (cfg.approvedUserIds || []).includes(userId);
}

export function ensureTelegramPairingCodeForUser(userId: string): string {
  const store = getLocalConfigStore();
  const raw = store.readRaw();
  const cfg = readTelegramPairingConfig(raw);
  const pendingCodes = { ...(cfg.pendingCodes || {}) };

  for (const [code, item] of Object.entries(pendingCodes)) {
    if (item.userId === userId) {
      return code;
    }
  }

  let code = generatePairingCode();
  while (pendingCodes[code]) {
    code = generatePairingCode();
  }
  pendingCodes[code] = {
    userId,
    createdAt: nowIso(),
  };

  writeTelegramPairingConfig(raw, {
    approvedUserIds: cfg.approvedUserIds || [],
    pendingCodes,
  });
  store.writeRaw(raw);
  return code;
}

export function approveTelegramPairingCode(
  codeInput: string,
): { ok: true; userId: string } | { ok: false; reason: string } {
  const code = codeInput.trim().toUpperCase();
  if (!code) {
    return { ok: false, reason: "empty_code" };
  }

  const store = getLocalConfigStore();
  const raw = store.readRaw();
  const cfg = readTelegramPairingConfig(raw);
  const pendingCodes = { ...(cfg.pendingCodes || {}) };
  const target = pendingCodes[code];
  if (!target) {
    return { ok: false, reason: "code_not_found" };
  }

  const approved = new Set(cfg.approvedUserIds || []);
  approved.add(target.userId);
  delete pendingCodes[code];

  writeTelegramPairingConfig(raw, {
    approvedUserIds: Array.from(approved),
    pendingCodes,
  });
  store.writeRaw(raw);

  return { ok: true, userId: target.userId };
}
