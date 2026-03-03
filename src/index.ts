import { runWechatAgent } from "./agent/run-wechat-agent.js";

function readInputFromArgs(): string {
  return process.argv.slice(2).join(" ").trim();
}

async function main() {
  const input = readInputFromArgs();
  if (!input) {
    console.error('Usage: npm run dev -- "你的消息内容或公众号链接"');
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
