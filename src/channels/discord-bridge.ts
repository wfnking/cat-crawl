import { Client, GatewayIntentBits, Partials, type Message } from "discord.js";
import { runWechatAgent } from "../agent/run-wechat-agent.js";
import type { AppEnv } from "../config/env.js";

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
  await message.reply(chunks[0] || "");
  if (chunks.length === 1) {
    return;
  }
  if (!("send" in message.channel) || typeof message.channel.send !== "function") {
    return;
  }
  for (let i = 1; i < chunks.length; i += 1) {
    await message.channel.send(chunks[i] || "");
  }
}

export async function startDiscordBridge(env: AppEnv): Promise<Client | null> {
  if (!env.discordEnabled) {
    console.info("[discord] DISCORD_ENABLED is false, skip startup");
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

  client.on("ready", () => {
    console.info(`[discord] logged in as ${client.user?.tag ?? "unknown"}`);
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
      console.info(`[discord] skip duplicate message_id=${dedupKey}`);
      return;
    }

    try {
      const result = await runWechatAgent(text, {
        context: {
          channel: "discord",
          senderId: message.author.id,
          roomId: message.channelId,
          messageId: message.id,
        },
      });
      await replyInChunks(message, result.reply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[discord] handle message failed: ${detail}`);
      try {
        await message.reply("处理失败，请稍后重试。");
      } catch (sendError) {
        const sendDetail = sendError instanceof Error ? sendError.message : String(sendError);
        console.error(`[discord] send failure message failed: ${sendDetail}`);
      }
    }
  });

  await client.login(env.discordBotToken);
  return client;
}
