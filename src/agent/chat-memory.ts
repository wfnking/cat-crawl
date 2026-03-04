export type ChatMemoryContext = {
  channel?: string;
  senderId?: string;
  roomId?: string;
};

type ChatMemoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_MEMORY_ROUNDS = 5;
const MAX_MEMORY_MESSAGES = MAX_MEMORY_ROUNDS * 2;
const sessionMemory = new Map<string, ChatMemoryMessage[]>();

function normalize(value: string | undefined): string {
  return value?.trim() || "";
}

function buildSessionKey(context: ChatMemoryContext | undefined): string {
  const channel = normalize(context?.channel) || "cli";
  const roomId = normalize(context?.roomId);
  if (roomId) {
    return `${channel}:room:${roomId}`;
  }
  const senderId = normalize(context?.senderId);
  if (senderId) {
    return `${channel}:user:${senderId}`;
  }
  return `${channel}:global`;
}

export function getRecentConversationMessages(
  context: ChatMemoryContext | undefined,
): ChatMemoryMessage[] {
  const key = buildSessionKey(context);
  const items = sessionMemory.get(key) || [];
  return items.map((item) => ({ ...item }));
}

export function appendConversationRound(
  context: ChatMemoryContext | undefined,
  userInput: string,
  assistantReply: string,
): void {
  const userText = userInput.trim();
  const replyText = assistantReply.trim();
  if (!userText || !replyText) {
    return;
  }

  const key = buildSessionKey(context);
  const items = sessionMemory.get(key) || [];
  items.push({ role: "user", content: userText });
  items.push({ role: "assistant", content: replyText });
  if (items.length > MAX_MEMORY_MESSAGES) {
    items.splice(0, items.length - MAX_MEMORY_MESSAGES);
  }
  sessionMemory.set(key, items);
}

export function clearConversationMemoryForTest(): void {
  sessionMemory.clear();
}
