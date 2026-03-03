import { runWechatAgent } from "../agent/run-wechat-agent.js";
import type { AppEnv } from "../config/env.js";

type FeishuMessageEvent = {
  message?: {
    message_type?: string;
    content?: string;
    chat_type?: string;
    chat_id?: string;
  };
  sender?: {
    sender_id?: {
      open_id?: string;
    };
  };
};

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
    domain,
  });

  const dispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (payload: unknown) => {
      const event = (payload as { event?: FeishuMessageEvent }).event || (payload as FeishuMessageEvent);
      const messageType = event.message?.message_type;
      const text = parseFeishuText(messageType, event.message?.content);
      if (!text) {
        console.info("[feishu] skip empty/non-text message");
        return;
      }

      console.info(`[feishu] inbound message: ${text.slice(0, 120)}`);
      const result = await runWechatAgent(text);
      const replyText = result.reply;

      const chatType = event.message?.chat_type;
      const chatId = event.message?.chat_id;
      const senderOpenId = event.sender?.sender_id?.open_id;

      if (chatType === "p2p" && senderOpenId) {
        await sendTextMessage(client, {
          receiveIdType: "open_id",
          receiveId: senderOpenId,
          text: replyText,
        });
        return;
      }

      if (chatId) {
        await sendTextMessage(client, {
          receiveIdType: "chat_id",
          receiveId: chatId,
          text: replyText,
        });
        return;
      }

      console.warn("[feishu] unable to resolve reply target");
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
