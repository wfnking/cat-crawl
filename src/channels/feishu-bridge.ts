import { runWechatAgent } from "../agent/run-wechat-agent.js";
import type { AppEnv } from "../config/env.js";

type FeishuMessageEvent = {
  message?: {
    message_type?: string;
    content?: string;
    chat_type?: string;
    chat_id?: string;
    message_id?: string;
  };
  sender?: {
    sender_id?: {
      open_id?: string;
    };
  };
};

const MESSAGE_DEDUP_TTL_MS = 10 * 60 * 1000;
const processedMessageIds = new Map<string, number>();
const TYPING_EMOJI = "Typing";

type TypingIndicatorState = {
  messageId: string;
  reactionId: string | null;
};

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

function parseFeishuText(messageType: string | undefined, content: string | undefined): string {
  if (!content) {
    return "";
  }
  if (messageType === "text") {
    try {
      const parsed = JSON.parse(content) as { text?: unknown };
      return typeof parsed.text === "string" ? parsed.text.trim() : "";
    } catch {
      return content.trim();
    }
  }
  return content.trim();
}

async function sendTextMessage(client: any, params: {
  receiveIdType: "open_id" | "chat_id";
  receiveId: string;
  text: string;
}): Promise<void> {
  await client.im.v1.message.create({
    params: {
      receive_id_type: params.receiveIdType,
    },
    data: {
      receive_id: params.receiveId,
      msg_type: "text",
      content: JSON.stringify({ text: params.text }),
    },
  });
}

async function addTypingIndicator(
  client: any,
  messageId: string | undefined,
): Promise<TypingIndicatorState> {
  if (!messageId) {
    return { messageId: "", reactionId: null };
  }
  try {
    const response = await client.im.v1.messageReaction.create({
      path: { message_id: messageId },
      data: {
        reaction_type: {
          emoji_type: TYPING_EMOJI,
        },
      },
    });
    const reactionId = (response as { data?: { reaction_id?: string } })?.data?.reaction_id ?? null;
    return { messageId, reactionId };
  } catch (error) {
    console.info(`[feishu] add typing indicator failed: ${formatError(error)}`);
    return { messageId, reactionId: null };
  }
}

async function removeTypingIndicator(client: any, state: TypingIndicatorState): Promise<void> {
  if (!state.messageId || !state.reactionId) {
    return;
  }
  try {
    await client.im.v1.messageReaction.delete({
      path: {
        message_id: state.messageId,
        reaction_id: state.reactionId,
      },
    });
  } catch (error) {
    console.info(`[feishu] remove typing indicator failed: ${formatError(error)}`);
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const maybe = error as Error & { response?: unknown };
    const response = maybe.response;
    if (response && typeof response === "object") {
      return `${error.message}; response=${JSON.stringify(response)}`;
    }
    return error.stack || error.message;
  }
  return String(error);
}

export async function startFeishuBridge(env: AppEnv): Promise<void> {
  if (!env.feishuEnabled) {
    console.info("[feishu] FEISHU_ENABLED is false, skip startup");
    return;
  }
  if (!env.feishuAppId || !env.feishuAppSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
  }

  const Lark = await import("@larksuiteoapi/node-sdk");
  const domain = env.feishuDomain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;

  const client = new Lark.Client({
    appId: env.feishuAppId,
    appSecret: env.feishuAppSecret,
    appType: Lark.AppType.SelfBuild,
    domain,
  });

  type ReplyTarget =
    | { receiveIdType: "chat_id"; receiveId: string }
    | { receiveIdType: "open_id"; receiveId: string };

  async function sendToTarget(target: ReplyTarget, text: string): Promise<void> {
    await sendTextMessage(client, {
      receiveIdType: target.receiveIdType,
      receiveId: target.receiveId,
      text,
    });
  }

  const dispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (payload: unknown) => {
      const event = (payload as { event?: FeishuMessageEvent }).event || (payload as FeishuMessageEvent);
      const messageId = event.message?.message_id;
      if (isDuplicateMessage(messageId)) {
        console.info(`[feishu] skip duplicate event message_id=${messageId}`);
        return;
      }

      const messageType = event.message?.message_type;
      const text = parseFeishuText(messageType, event.message?.content);
      if (!text) {
        console.info("[feishu] skip empty/non-text message");
        return;
      }

      console.info(`[feishu] inbound message: ${text.slice(0, 120)}`);

      const chatType = event.message?.chat_type;
      const chatId = event.message?.chat_id;
      const senderOpenId = event.sender?.sender_id?.open_id;
      console.info(
        `[feishu] outbound target chat_type=${chatType ?? "unknown"} chat_id=${chatId ?? "none"} open_id=${senderOpenId ?? "none"}`,
      );

      let target: ReplyTarget | null = null;
      if (chatType === "p2p" && senderOpenId) {
        target = {
          receiveIdType: "open_id",
          receiveId: senderOpenId,
        };
      } else if (chatId) {
        target = {
          receiveIdType: "chat_id",
          receiveId: chatId,
        };
      } else if (senderOpenId) {
        target = {
          receiveIdType: "open_id",
          receiveId: senderOpenId,
        };
      } else {
        console.warn("[feishu] unable to resolve reply target");
        return;
      }

      const typingState = await addTypingIndicator(client, messageId);
      let replyText = "";
      try {
        const result = await runWechatAgent(text);
        replyText = result.reply;
      } catch (error) {
        console.error(`[feishu] runWechatAgent failed: ${formatError(error)}`);
        try {
          await sendToTarget(target, "处理失败，请稍后重试。");
        } catch (sendError) {
          console.error(`[feishu] send failure message failed: ${formatError(sendError)}`);
        }
        return;
      } finally {
        await removeTypingIndicator(client, typingState);
      }

      try {
        await sendToTarget(target, replyText);
        return;
      } catch (error) {
        console.error(`[feishu] send message failed: ${formatError(error)}`);
        return;
      }
    },
  });

  const wsClient = new Lark.WSClient({
    appId: env.feishuAppId,
    appSecret: env.feishuAppSecret,
    domain,
  });

  console.info("[feishu] starting websocket client");
  await wsClient.start({ eventDispatcher: dispatcher });
  console.info("[feishu] websocket client started");
}
