import { runWechatAgent } from "../agent/run-wechat-agent.js";
import type { AppEnv } from "../config/env.js";
import { ensureTelegramPairingCodeForUser, isTelegramUserApproved } from "../config/telegram-pairing.js";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: {
      id?: number;
      type?: string;
    };
    from?: {
      id?: number;
    };
  };
};

type TelegramGetUpdatesResponse = {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
};

const MESSAGE_DEDUP_TTL_MS = 10 * 60 * 1000;
const processedMessageIds = new Map<string, number>();

function isDuplicateMessage(messageId: string | undefined): boolean {
  if (!messageId) {
    return false;
  }

  const now = Date.now();
  for (const [id, ts] of processedMessageIds) {
    if (now - ts > MESSAGE_DEDUP_TTL_MS) {
      processedMessageIds.delete(id);
    }
  }

  if (processedMessageIds.has(messageId)) {
    return true;
  }
  processedMessageIds.set(messageId, now);
  return false;
}

function splitMessage(text: string, maxLength = 3500): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLength) {
    chunks.push(rest.slice(0, maxLength));
    rest = rest.slice(maxLength);
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`telegram sendMessage failed: status=${response.status} body=${body}`);
  }
}

async function sendTelegramChatAction(
  botToken: string,
  chatId: number,
  action: "typing" | "record_voice" = "typing",
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendChatAction`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      action,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`telegram sendChatAction failed: status=${response.status} body=${body}`);
  }
}

function startTypingIndicator(
  botToken: string,
  chatId: number,
  intervalMs = 5000,
): { stop: () => void } {
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      await sendTelegramChatAction(botToken, chatId, "typing");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[telegram] typing signal failed: ${detail}`);
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function fetchTelegramUpdates(
  botToken: string,
  offset: number,
  timeoutSeconds: number,
): Promise<TelegramUpdate[]> {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ["message"],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`telegram getUpdates failed: status=${response.status} body=${body}`);
  }

  const payload = (await response.json()) as TelegramGetUpdatesResponse;
  if (!payload.ok) {
    throw new Error(`telegram getUpdates rejected: ${payload.description || "unknown error"}`);
  }
  if (!Array.isArray(payload.result)) {
    return [];
  }
  return payload.result;
}

async function handleIncomingTextMessage(
  botToken: string,
  env: AppEnv,
  message: TelegramUpdate["message"] | undefined,
): Promise<void> {
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type || "";
  const text = message?.text?.trim() || "";
  const messageId = message?.message_id;
  const senderId = message?.from?.id;

  if (!chatId || !text) {
    return;
  }

  console.info(
    `[telegram] received message chatId=${chatId} chatType=${chatType || "unknown"} senderId=${senderId || "unknown"} textLen=${text.length}`,
  );

  const dedupKey = messageId ? `telegram:${chatId}:${messageId}` : undefined;
  if (isDuplicateMessage(dedupKey)) {
    console.info(`[telegram] skip duplicate message_id=${dedupKey}`);
    return;
  }

  if (env.telegramDmPolicy === "pairing" && chatType === "private") {
    const telegramUserId = senderId ? String(senderId) : "";
    if (!telegramUserId || !isTelegramUserApproved(telegramUserId)) {
      const code = ensureTelegramPairingCodeForUser(telegramUserId || "unknown");
      console.info(
        `[telegram] pairing required for userId=${telegramUserId || "unknown"}, code=${code}`,
      );
      const textReply = [
        "Cat-Crawl: access not configured.",
        "",
        `Your Telegram user id: ${telegramUserId || "unknown"}`,
        "",
        `Pairing code: ${code}`,
        "",
        "Ask the bot owner to approve with:",
        `cat-crawl pairing approve telegram ${code}`,
      ].join("\n");
      await sendTelegramMessage(botToken, chatId, textReply);
      return;
    }
  }

  const typing = startTypingIndicator(botToken, chatId);
  try {
    const result = await runWechatAgent(text, {
      context: {
        channel: "telegram",
        senderId: senderId ? String(senderId) : undefined,
        roomId: String(chatId),
        messageId: messageId ? String(messageId) : undefined,
      },
    });
    const parts = splitMessage(result.reply);
    for (const part of parts) {
      await sendTelegramMessage(botToken, chatId, part);
    }
    console.info(
      `[telegram] reply sent chatId=${chatId} senderId=${senderId || "unknown"} parts=${parts.length}`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[telegram] handle message failed: ${detail}`);
    try {
      await sendTelegramMessage(botToken, chatId, "处理失败，请稍后重试。");
    } catch (sendError) {
      const sendDetail = sendError instanceof Error ? sendError.message : String(sendError);
      console.error(`[telegram] send failure message failed: ${sendDetail}`);
    }
  } finally {
    typing.stop();
  }
}

async function startTelegramPolling(botToken: string, env: AppEnv): Promise<void> {
  const timeoutSeconds = 30;
  let offset = 0;

  console.info(`[telegram] polling started (timeout=${timeoutSeconds}s)`);

  for (;;) {
    try {
      const updates = await fetchTelegramUpdates(botToken, offset, timeoutSeconds);
      for (const update of updates) {
        if (typeof update.update_id === "number") {
          offset = Math.max(offset, update.update_id + 1);
        }
        await handleIncomingTextMessage(botToken, env, update.message);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[telegram] polling error: ${detail}`);
      await sleep(1500);
    }
  }
}

export async function startTelegramPollingChannel(env: AppEnv): Promise<null> {
  if (!env.telegramEnabled) {
    console.info("[telegram] TELEGRAM_ENABLED is false, skip startup");
    return null;
  }
  const botToken = env.telegramBotToken;
  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  void startTelegramPolling(botToken, env);
  return null;
}
