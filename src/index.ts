import { startFeishuBridge } from "./channels/feishu-bridge.js";
import { loadEnv } from "./config/env.js";
import { runWechatAgent } from "./agent/run-wechat-agent.js";

function readInputFromArgs(): string {
  return process.argv.slice(2).join(" ").trim();
}

function isFeishuMode(): boolean {
  return process.argv.includes("--feishu");
}

async function main() {
  if (isFeishuMode()) {
    const env = loadEnv();
    await startFeishuBridge(env);
    return;
  }

  const input = readInputFromArgs();
  if (!input) {
    console.error(
      'Usage:\n1) npm run dev -- "你的消息内容或公众号链接"\n2) npm run dev -- --feishu',
    );
    process.exit(1);
  }

  const result = await runWechatAgent(input);
  console.log(result.reply);
  if (result.usedTools.length > 0) {
    console.log(`Used tools: ${result.usedTools.join(", ")}`);
  }
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Fatal error: ${detail}`);
  process.exit(1);
});
