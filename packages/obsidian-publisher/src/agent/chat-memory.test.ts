import assert from "node:assert/strict";
import test from "node:test";
import {
  appendConversationRound,
  clearConversationMemoryForTest,
  getRecentConversationMessages,
} from "./chat-memory.js";

test("chat memory keeps only latest 5 rounds", () => {
  clearConversationMemoryForTest();
  const context = {
    channel: "telegram",
    roomId: "room-1",
    senderId: "user-1",
  };

  for (let i = 1; i <= 7; i += 1) {
    appendConversationRound(context, `u${i}`, `a${i}`);
  }

  const messages = getRecentConversationMessages(context);
  assert.equal(messages.length, 10);
  assert.equal(messages[0]?.content, "u3");
  assert.equal(messages[1]?.content, "a3");
  assert.equal(messages[8]?.content, "u7");
  assert.equal(messages[9]?.content, "a7");
});

test("chat memory isolates different sessions", () => {
  clearConversationMemoryForTest();
  appendConversationRound(
    {
      channel: "telegram",
      roomId: "room-a",
      senderId: "user-1",
    },
    "hello-a",
    "reply-a",
  );
  appendConversationRound(
    {
      channel: "telegram",
      roomId: "room-b",
      senderId: "user-1",
    },
    "hello-b",
    "reply-b",
  );

  const aMessages = getRecentConversationMessages({
    channel: "telegram",
    roomId: "room-a",
    senderId: "user-1",
  });
  const bMessages = getRecentConversationMessages({
    channel: "telegram",
    roomId: "room-b",
    senderId: "user-1",
  });

  assert.equal(aMessages.length, 2);
  assert.equal(bMessages.length, 2);
  assert.equal(aMessages[0]?.content, "hello-a");
  assert.equal(bMessages[0]?.content, "hello-b");
});
