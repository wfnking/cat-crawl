import assert from "node:assert/strict";
import test from "node:test";
import { transcribeWithGemini } from "./gemini.js";

test("transcribeWithGemini should call Gemini with default model", async () => {
  const result = await transcribeWithGemini("/tmp/audio.mp3", {
    apiKey: "gemini-demo-key",
    readFileAsync: async () => Buffer.from("audio-bytes"),
    fetchImpl: async (input, init) => {
      assert.match(String(input), /gemini-3-flash-preview:generateContent/);
      assert.match(String(input), /key=gemini-demo-key/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.contents[0].parts[0].inlineData.mimeType, "audio/mpeg");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "gemini transcript" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(result.provider, "gemini");
  assert.equal(result.text, "gemini transcript");
});

test("transcribeWithGemini should allow explicit model override", async () => {
  await transcribeWithGemini("/tmp/audio.mp3", {
    apiKey: "gemini-demo-key",
    model: "gemini-2.5-flash",
    readFileAsync: async () => Buffer.from("audio-bytes"),
    fetchImpl: async (input) => {
      assert.match(String(input), /gemini-2.5-flash:generateContent/);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "override transcript" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
});

test("transcribeWithGemini should normalize provider errors", async () => {
  await assert.rejects(
    () =>
      transcribeWithGemini("/tmp/audio.mp3", {
        apiKey: "gemini-demo-key",
        readFileAsync: async () => Buffer.from("audio-bytes"),
        fetchImpl: async () => new Response("bad request", { status: 400 }),
      }),
    /Gemini transcription failed/,
  );
});
