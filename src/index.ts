#!/usr/bin/env node

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { runWechatAgent } from "./agent/run-wechat-agent.js";
import { startDiscordBridge } from "./channels/discord-bridge.js";
import { startFeishuBridge } from "./channels/feishu-bridge.js";
import { startTelegramPollingChannel } from "./channels/telegram-webhook.js";
import { buildAgentSetupConfig, getAgentSetupSteps } from "./config/agent-wizard.js";
import { loadEnv } from "./config/env.js";
import { buildGatewaySetupConfig, getGatewaySetupSteps } from "./config/gateway-wizard.js";
import {
  getLocalConfigStore,
  parseAgentConfig,
  parseChannelConfig,
  type AgentConfigValue,
  type ChannelConfigValue,
} from "./config/local-config.js";
import { approveTelegramPairingCode } from "./config/telegram-pairing.js";

type ChannelModes = {
  feishu: boolean;
  telegram: boolean;
  discord: boolean;
};

type SetGetCommand = {
  action: "set" | "get";
  key: string;
  value?: string;
};

type PairingApproveCommand = {
  channel: "telegram";
  code: string;
};

const CHANNEL_FLAGS = new Set(["--feishu", "--telegram", "--discord", "--all-channels"]);

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = asObject(parent[key]);
  if (existing) {
    return existing;
  }
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

function persistStructuredChannelConfig(
  channel: ChannelConfigValue,
  values: Record<string, string>,
): void {
  const store = getLocalConfigStore();
  const raw = store.readRaw();

  const flatChannelKeys = [
    "gateway",
    "FEISHU_ENABLED",
    "TELEGRAM_ENABLED",
    "DISCORD_ENABLED",
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_DOMAIN",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_DM_POLICY",
    "TELEGRAM_GROUP_POLICY",
    "TELEGRAM_STREAM_MODE",
    "TELEGRAM_TYPING_MODE",
    "TELEGRAM_TYPING_INTERVAL_SECONDS",
    "DISCORD_BOT_TOKEN",
    "DISCORD_GROUP_POLICY",
    "TELEGRAM_MODE",
    "WEBHOOK_HOST",
    "WEBHOOK_PORT",
    "TELEGRAM_WEBHOOK_PATH",
    "TELEGRAM_WEBHOOK_SECRET",
  ];
  for (const key of flatChannelKeys) {
    delete raw[key];
  }

  raw.channel = channel;
  const channels = ensureObject(raw, "channels");

  const telegram = ensureObject(channels, "telegram");
  telegram.enabled = channel === "telegram" || channel === "all";
  telegram.dmPolicy = values.TELEGRAM_DM_POLICY || "pairing";
  telegram.groupPolicy = values.TELEGRAM_GROUP_POLICY || "allowlist";
  telegram.streamMode = values.TELEGRAM_STREAM_MODE || "partial";
  telegram.typingMode = values.TELEGRAM_TYPING_MODE || "thinking";
  {
    const rawInterval = values.TELEGRAM_TYPING_INTERVAL_SECONDS?.trim() || "6";
    const parsed = Number(rawInterval);
    telegram.typingIntervalSeconds =
      Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6;
  }
  if (values.TELEGRAM_BOT_TOKEN) {
    telegram.botToken = values.TELEGRAM_BOT_TOKEN;
  }

  const discord = ensureObject(channels, "discord");
  discord.enabled = channel === "discord" || channel === "all";
  discord.groupPolicy = values.DISCORD_GROUP_POLICY || "allowlist";
  if (!asObject(discord.guilds)) {
    discord.guilds = {};
  }
  if (values.DISCORD_BOT_TOKEN) {
    discord.token = values.DISCORD_BOT_TOKEN;
  }

  const feishu = ensureObject(channels, "feishu");
  const accounts = ensureObject(feishu, "accounts");
  const main = ensureObject(accounts, "main");
  main.enabled = channel === "feishu" || channel === "all";
  main.domain = values.FEISHU_DOMAIN || "feishu";
  if (values.FEISHU_APP_ID) {
    main.appId = values.FEISHU_APP_ID;
  }
  if (values.FEISHU_APP_SECRET) {
    main.appSecret = values.FEISHU_APP_SECRET;
  }

  store.writeRaw(raw);
}

function persistStructuredAgentConfig(agent: AgentConfigValue, values: Record<string, string>): void {
  const store = getLocalConfigStore();
  const raw = store.readRaw();

  const flatAgentKeys = ["agent", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"];
  for (const key of flatAgentKeys) {
    delete raw[key];
  }

  const agentConfig = ensureObject(raw, "agent");
  agentConfig.provider = agent;

  if (agent === "deepseek") {
    const deepseek = ensureObject(agentConfig, "deepseek");
    deepseek.apiKey = values.DEEPSEEK_API_KEY || "";
    deepseek.baseUrl = values.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
    deepseek.model = values.DEEPSEEK_MODEL || "deepseek-chat";
  }

  store.writeRaw(raw);
}

function parseArgs(): string[] {
  return process.argv.slice(2);
}

function hasAnyChannelMode(modes: ChannelModes): boolean {
  return modes.feishu || modes.telegram || modes.discord;
}

function emptyModes(): ChannelModes {
  return {
    feishu: false,
    telegram: false,
    discord: false,
  };
}

function modesFromChannel(channel: ChannelConfigValue): ChannelModes {
  if (channel === "all") {
    return {
      feishu: true,
      telegram: true,
      discord: true,
    };
  }
  return {
    feishu: channel === "feishu",
    telegram: channel === "telegram",
    discord: channel === "discord",
  };
}

function parseExplicitModes(args: string[]): ChannelModes {
  const runAll = args.includes("--all-channels");
  if (runAll) {
    return {
      feishu: true,
      telegram: true,
      discord: true,
    };
  }
  return {
    feishu: args.includes("--feishu"),
    telegram: args.includes("--telegram"),
    discord: args.includes("--discord"),
  };
}

function readInputFromArgs(args: string[]): string {
  return args
    .filter((arg) => !CHANNEL_FLAGS.has(arg))
    .join(" ")
    .trim();
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      '1) cat-crawl "你的消息内容或公众号链接"',
      "2) cat-crawl --feishu",
      "3) cat-crawl --telegram",
      "4) cat-crawl --discord",
      "5) cat-crawl --all-channels",
      "6) cat-crawl set channel telegram",
      "7) cat-crawl get channel [fallback]",
      "8) cat-crawl set agent deepseek",
      "9) cat-crawl get agent [fallback]",
      "10) cat-crawl pairing approve telegram <code>",
      "11) cat-crawl config set ...（兼容旧命令）",
    ].join("\n"),
  );
}

function parseSetGetCommand(args: string[]): SetGetCommand | null {
  const action = args[0]?.trim().toLowerCase();
  if (action === "set" || action === "get") {
    return {
      action,
      key: args[1]?.trim() || "",
      value: args[2]?.trim(),
    };
  }

  if (args[0] === "config") {
    const compatAction = args[1]?.trim().toLowerCase();
    if (compatAction === "set" || compatAction === "get") {
      return {
        action: compatAction,
        key: args[2]?.trim() || "",
        value: args[3]?.trim(),
      };
    }
  }

  return null;
}

function parsePairingApproveCommand(args: string[]): PairingApproveCommand | null {
  const action = args[0]?.trim().toLowerCase();
  const subAction = args[1]?.trim().toLowerCase();
  const channel = args[2]?.trim().toLowerCase();
  if (action !== "pairing" || subAction !== "approve" || channel !== "telegram") {
    return null;
  }
  const code = args[3]?.trim();
  if (!code) {
    throw new Error("Usage: cat-crawl pairing approve telegram <code>");
  }
  return {
    channel: "telegram",
    code,
  };
}

async function promptGatewaySetup(channel: ChannelConfigValue): Promise<Record<string, string>> {
  const store = getLocalConfigStore();
  const existing = store.all();
  const steps = getGatewaySetupSteps(channel);
  const answers: Record<string, string> = {};

  if (steps.length === 0) {
    return buildGatewaySetupConfig(channel, answers);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (const step of steps) {
      if (step.shouldAsk && !step.shouldAsk(answers, existing)) {
        continue;
      }
      const preset = existing[step.key]?.trim() || step.defaultValue || "";
      while (true) {
        const prompt = preset ? `${step.label} [${preset}]: ` : `${step.label}: `;
        const raw = (await rl.question(prompt)).trim();
        const value = raw || preset;
        if (step.required && !value) {
          console.log("该字段必填，请重新输入。");
          continue;
        }
        answers[step.key] = value;
        break;
      }
    }
  } finally {
    rl.close();
  }

  return buildGatewaySetupConfig(channel, answers);
}

async function promptAgentSetup(agent: AgentConfigValue): Promise<Record<string, string>> {
  const store = getLocalConfigStore();
  const existing = store.all();
  const steps = getAgentSetupSteps(agent);
  const answers: Record<string, string> = {};

  if (steps.length === 0) {
    return buildAgentSetupConfig(agent, answers);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (const step of steps) {
      const preset = existing[step.key]?.trim() || step.defaultValue || "";
      while (true) {
        const prompt = preset ? `${step.label} [${preset}]: ` : `${step.label}: `;
        const raw = (await rl.question(prompt)).trim();
        const value = raw || preset;
        if (step.required && !value) {
          console.log("该字段必填，请重新输入。");
          continue;
        }
        answers[step.key] = value;
        break;
      }
    }
  } finally {
    rl.close();
  }

  return buildAgentSetupConfig(agent, answers);
}

async function handleSetGetCommand(command: SetGetCommand): Promise<void> {
  const store = getLocalConfigStore();
  const key = command.key;
  const value = command.value;

  if (!key) {
    throw new Error("Usage: cat-crawl <set|get> <key> [value]");
  }

  if (key === "gateway") {
    throw new Error("配置键 gateway 已废弃，请改用 channel");
  }

  if (command.action === "set") {
    if (!value) {
      throw new Error("Usage: cat-crawl set <key> <value>");
    }

    if (key === "channel") {
      const channel = parseChannelConfig(value);
      if (!channel) {
        throw new Error("channel 只支持 feishu / telegram / discord / all");
      }
      const values = await promptGatewaySetup(channel);
      persistStructuredChannelConfig(channel, values);
      console.log(`channel=${channel}`);
      console.log("已完成渠道交互配置，配置已写入 ~/.cat-crawl/config.json");
      return;
    }

    if (key === "agent") {
      const agent = parseAgentConfig(value);
      if (!agent) {
        throw new Error("agent 当前只支持 deepseek");
      }
      const values = await promptAgentSetup(agent);
      persistStructuredAgentConfig(agent, values);
      console.log(`agent=${agent}`);
      console.log("已完成 Agent 交互配置，配置已写入 ~/.cat-crawl/config.json");
      return;
    }

    store.set(key, value);
    console.log(`${key}=${value}`);
    return;
  }

  let current = store.get(key);
  if (current === undefined && key === "agent") {
    const rawAgent = asObject(store.readRaw().agent);
    const provider = rawAgent?.provider;
    if (typeof provider === "string" && provider.trim()) {
      current = provider.trim();
    }
  }
  const output = current ?? value;
  if (output === undefined) {
    throw new Error(`Config key not found: ${key}`);
  }
  console.log(output);
}

function handlePairingApproveCommand(command: PairingApproveCommand): void {
  if (command.channel !== "telegram") {
    throw new Error("Only telegram pairing is supported");
  }
  const result = approveTelegramPairingCode(command.code);
  if (!result.ok) {
    if (result.reason === "code_not_found") {
      throw new Error("审批失败：配对码不存在或已过期，请让用户重新发送消息获取新的配对码。");
    }
    if (result.reason === "empty_code") {
      throw new Error("审批失败：配对码不能为空。");
    }
    throw new Error("审批失败：未知错误。");
  }
  console.log(`pairing approved: telegram user ${result.userId}`);
}

function resolveModes(args: string[], input: string): ChannelModes {
  const explicit = parseExplicitModes(args);
  if (hasAnyChannelMode(explicit)) {
    return explicit;
  }

  if (input) {
    return emptyModes();
  }

  const channelRaw = getLocalConfigStore().get("channel");
  const channel = parseChannelConfig(channelRaw);
  if (!channel) {
    return emptyModes();
  }
  return modesFromChannel(channel);
}

async function startChannels(modes: ChannelModes): Promise<void> {
  const env = loadEnv();
  const starts: Array<Promise<unknown>> = [];

  if (modes.feishu) {
    starts.push(startFeishuBridge({ ...env, feishuEnabled: true }));
  }
  if (modes.telegram) {
    starts.push(startTelegramPollingChannel({ ...env, telegramEnabled: true }));
  }
  if (modes.discord) {
    starts.push(startDiscordBridge({ ...env, discordEnabled: true }));
  }

  await Promise.all(starts);
  console.info("[index] channels started");
}

async function runCliMode(input: string): Promise<void> {
  const result = await runWechatAgent(input, {
    context: {
      channel: "cli",
    },
  });
  console.log(result.reply);
  if (result.usedTools.length > 0) {
    console.log(`Used tools: ${result.usedTools.join(", ")}`);
  }
}

async function main() {
  const args = parseArgs();
  const pairingCommand = parsePairingApproveCommand(args);
  if (pairingCommand) {
    handlePairingApproveCommand(pairingCommand);
    return;
  }
  const command = parseSetGetCommand(args);
  if (command) {
    await handleSetGetCommand(command);
    return;
  }

  const input = readInputFromArgs(args);
  const modes = resolveModes(args, input);

  if (hasAnyChannelMode(modes)) {
    await startChannels(modes);
    return;
  }

  if (!input) {
    printUsage();
    process.exit(1);
  }

  await runCliMode(input);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Fatal error: ${detail}`);
  process.exit(1);
});
