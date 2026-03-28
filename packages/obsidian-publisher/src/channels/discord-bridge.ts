import { Client, GatewayIntentBits, Partials, type Message } from "discord.js";
import { createLogger } from "@cat-crawl/core";
import { runAgent } from "../workflows/run-agent.js";
import type { AppEnv } from "../config/env.js";
import { toUserFacingErrorMessage } from "./helpers/user-facing-error.js";

const MESSAGE_DEDUP_TTL_MS = 10 * 60 * 1000;
const processedMessageIds = new Map<string, number>();
const logger = createLogger();

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

function splitMessage(text: string, maxLength = 1800): string[] {
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

async function replyInChunks(message: Message, text: string): Promise<void> {
  const chunks = splitMessage(text);
  if (chunks.length === 0) {
    return;
  }
  if ("send" in message.channel && typeof message.channel.send === "function") {
    for (const chunk of chunks) {
      await message.channel.send({
        content: chunk || "",
        allowedMentions: { parse: [] },
      });
    }
    return;
  }
  await message.reply({
    content: chunks[0] || "",
    allowedMentions: { repliedUser: false },
  });
}

function startTypingIndicator(message: Message, intervalMs = 4500): { stop: () => void } {
  let stopped = false;
  const trigger = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      const sendTyping = (
        message.channel as { sendTyping?: (() => Promise<unknown>) | undefined }
      ).sendTyping;
      if (typeof sendTyping === "function") {
        await sendTyping.call(message.channel);
      }
    } catch {
      // ignore typing failures
    }
  };

  void trigger();
  const timer = setInterval(() => {
    void trigger();
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export async function startDiscordBridge(env: AppEnv): Promise<Client | null> {
  if (!env.discordEnabled) {
    logger.info("[discord] DISCORD_ENABLED is false, skip startup");
    return null;
  }
  if (!env.discordBotToken) {
    throw new Error("Missing DISCORD_BOT_TOKEN");
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.on("clientReady", () => {
    logger.info("[discord] channel started");
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) {
      return;
    }

    const text = message.content?.trim() || "";
    if (!text) {
      return;
    }

    const dedupKey = message.id ? `discord:${message.id}` : undefined;
    if (isDuplicateMessage(dedupKey)) {
      logger.info(`[discord] skip duplicate message_id=${dedupKey}`);
      return;
    }

    const typing = startTypingIndicator(message);
    try {
      const result = await runAgent(text, {
        context: {
          channel: "discord",
          senderId: message.author.id,
          roomId: message.channelId,
          messageId: message.id,
        },
      });
      typing.stop();
      await replyInChunks(message, result.reply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`[discord] handle message failed: ${detail}`);
      try {
        await replyInChunks(message, toUserFacingErrorMessage(error));
      } catch (sendError) {
        const sendDetail = sendError instanceof Error ? sendError.message : String(sendError);
        logger.error(`[discord] send failure message failed: ${sendDetail}`);
      }
    } finally {
      typing.stop();
    }
  });

  await client.login(env.discordBotToken);
  return client;
}
