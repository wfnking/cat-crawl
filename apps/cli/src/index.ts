#!/usr/bin/env node

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asObject, createLogger, ensureObject } from "@cat-crawl/core";
import {
  approveTelegramPairingCode,
  buildAgentSetupConfig,
  buildChannelSetupConfig,
  getLocalConfigStore,
  getAgentSetupSteps,
  getChannelSetupSteps,
  loadEnv,
  parseAgentConfig,
  parseChannelConfig,
  runAgent,
  startDiscordBridge,
  startFeishuBridge,
  startTelegramPollingChannel,
  type AgentConfigValue,
  type ChannelConfigValue,
} from "@cat-crawl/obsidian-publisher";
import {
  hasAnyChannelMode,
  parseObsidianCommand,
  type ChannelModes,
  type PairingApproveCommand,
  type SetGetCommand,
} from "./obsidian-command.js";
import { formatConfigValue, getConfigValueByPath } from "./config-path.js";

const logger = createLogger();
const require = createRequire(import.meta.url);

type CliPackageJson = {
  version?: string;
};

function getCliVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDir, "../package.json"),
    resolve(currentDir, "../../package.json"),
    resolve(currentDir, "../../../package.json"),
    resolve(currentDir, "../../../../package.json"),
  ];

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) {
        continue;
      }
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as CliPackageJson;
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // continue
    }
  }

  try {
    const pkg = require("../package.json") as CliPackageJson;
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      return pkg.version.trim();
    }
  } catch {
    // fall through
  }

  return "unknown";
}

function isVersionCommand(args: string[]): boolean {
  if (args.length !== 1) {
    return false;
  }
  const value = args[0]?.trim().toLowerCase();
  return value === "version" || value === "--version" || value === "-v";
}

function persistStructuredChannelConfig(
  channel: ChannelConfigValue,
  values: Record<string, string>,
): void {
  const store = getLocalConfigStore();
  const raw = store.readRaw();

  const flatChannelKeys = [
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
    telegram.typingIntervalSeconds = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6;
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

function persistStructuredAgentConfig(
  agent: AgentConfigValue,
  values: Record<string, string>,
): void {
  const store = getLocalConfigStore();
  const raw = store.readRaw();

  const flatAgentKeys = [
    "agent",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GOOGLE_VERTEX_API_KEY",
    "VERTEX_PROJECT",
    "VERTEX_LOCATION",
    "VERTEX_ENDPOINT",
  ];
  for (const key of flatAgentKeys) {
    delete raw[key];
  }

  const agentConfig = ensureObject(raw, "agent");
  agentConfig.provider = agent;
  delete agentConfig.openai;
  delete agentConfig.gemini;
  delete agentConfig.vertex;

  if (agent === "openai") {
    const openai = ensureObject(agentConfig, "openai");
    openai.apiKey = values.OPENAI_API_KEY || "";
    openai.baseUrl = values.OPENAI_BASE_URL || "https://api.openai.com/v1";
    openai.model = values.OPENAI_MODEL || "gpt-4o-mini";
  } else if (agent === "gemini") {
    const gemini = ensureObject(agentConfig, "gemini");
    gemini.apiKey = values.GEMINI_API_KEY || "";
    gemini.model = values.GEMINI_MODEL || "gemini-3.1-flash-lite-preview";
  } else if (agent === "vertex") {
    const vertex = ensureObject(agentConfig, "vertex");
    if (values.GOOGLE_VERTEX_API_KEY) {
      vertex.apiKey = values.GOOGLE_VERTEX_API_KEY;
    }
    if (values.VERTEX_PROJECT) {
      vertex.project = values.VERTEX_PROJECT;
    }
    vertex.location = values.VERTEX_LOCATION || "us-central1";
    vertex.model = values.GEMINI_MODEL || "gemini-3.1-flash-lite-preview";
  }

  store.writeRaw(raw);
}

function parseArgs(): string[] {
  const args = process.argv.slice(2);
  if (args[0] === "--") {
    return args.slice(1);
  }
  return args;
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

function printUsage(): void {
  logger.error(
    [
      "Usage:",
      "0) cat-crawl version | --version | -v",
      "1) cat-crawl obsidian start [--feishu|--telegram|--discord|--all-channels]",
      '2) cat-crawl obsidian run "你的消息内容或文章链接"',
      "3) cat-crawl obsidian config set channel telegram",
      "4) cat-crawl obsidian config get channel [fallback]",
      "5) cat-crawl obsidian config set agent openai|gemini|vertex",
      "6) cat-crawl obsidian config get agent [fallback]",
      "7) cat-crawl obsidian pairing approve telegram <code>",
    ].join("\n"),
  );
}

async function promptChannelSetup(channel: ChannelConfigValue): Promise<Record<string, string>> {
  const store = getLocalConfigStore();
  const existing = store.all();
  const steps = getChannelSetupSteps(channel);
  const answers: Record<string, string> = {};

  if (steps.length === 0) {
    return buildChannelSetupConfig(channel, answers);
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
          logger.log("该字段必填，请重新输入。");
          continue;
        }
        answers[step.key] = value;
        break;
      }
    }
  } finally {
    rl.close();
  }

  return buildChannelSetupConfig(channel, answers);
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
      const structuredAgent = asObject(store.readRaw().agent);
      const agentConfig = asObject(structuredAgent?.[agent as string]) as
        | Record<string, unknown>
        | undefined;
      const fieldByStepKey: Record<string, string> = {
        OPENAI_API_KEY: "apiKey",
        OPENAI_BASE_URL: "baseUrl",
        OPENAI_MODEL: "model",
        GEMINI_API_KEY: "apiKey",
        GEMINI_MODEL: "model",
        GOOGLE_VERTEX_API_KEY: "apiKey",
        VERTEX_PROJECT: "project",
        VERTEX_LOCATION: "location",
        VERTEX_ENDPOINT: "endpoint",
      };
      const existingKey = agentConfig?.[fieldByStepKey[step.key] || step.key];
      const preset =
        existing[step.key]?.trim() ||
        (typeof existingKey === "string" ? existingKey : undefined) ||
        step.defaultValue ||
        "";
      while (true) {
        let displayPreset = preset;
        if (displayPreset && step.label.toLowerCase().includes("key")) {
          displayPreset = "(已配置，直接回车保留)";
        }
        const prompt = displayPreset ? `${step.label} [${displayPreset}]: ` : `${step.label}: `;
        const raw = (await rl.question(prompt)).trim();
        const value = raw || preset;
        if (step.required && !value) {
          logger.log("该字段必填，请重新输入。");
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
    throw new Error("Usage: cat-crawl obsidian config <set|get> <key> [value]");
  }
  if (key === "gateway") {
    throw new Error("gateway 已移除，请使用 channel。");
  }

  if (command.action === "set") {
    if (!value) {
      throw new Error("Usage: cat-crawl obsidian config set <key> <value>");
    }

    if (key === "channel") {
      const channel = parseChannelConfig(value);
      if (!channel) {
        throw new Error("channel 只支持 feishu / telegram / discord / all");
      }
      const values = await promptChannelSetup(channel);
      persistStructuredChannelConfig(channel, values);
      logger.log(`channel=${channel}`);
      logger.log("已完成渠道交互配置，配置已写入 ~/.cat-crawl/config.json");
      return;
    }

    if (key === "agent") {
      const agent = parseAgentConfig(value);
      if (!agent) {
        throw new Error("agent 当前只支持 openai / gemini / vertex");
      }
      const values = await promptAgentSetup(agent);
      persistStructuredAgentConfig(agent, values);
      logger.log(`agent=${agent}`);
      logger.log("已完成 Agent 交互配置，配置已写入 ~/.cat-crawl/config.json");
      return;
    }

    store.set(key, value);
    logger.log(`${key}=${value}`);
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
  if (current === undefined && key.includes(".")) {
    current = formatConfigValue(getConfigValueByPath(store.readRaw(), key));
  }
  const output = current ?? value;
  if (output === undefined) {
    throw new Error(`Config key not found: ${key}`);
  }
  logger.log(output);
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
  logger.log(`pairing approved: telegram user ${result.userId}`);
}

function resolveModes(explicit: ChannelModes): ChannelModes {
  if (hasAnyChannelMode(explicit)) {
    return explicit;
  }

  const store = getLocalConfigStore();
  const channelRaw = store.get("channel");
  const parsed = parseChannelConfig(channelRaw);
  if (parsed) {
    return modesFromChannel(parsed);
  }

  const structuredChannel = store.readRaw().channel;
  if (typeof structuredChannel === "string") {
    const structuredParsed = parseChannelConfig(structuredChannel);
    if (structuredParsed) {
      return modesFromChannel(structuredParsed);
    }
  }

  throw new Error(
    "未配置默认 channel。请先运行 `cat-crawl obsidian config set channel telegram`，或在启动时加 --telegram/--feishu/--discord。",
  );
}

async function startChannels(modes: ChannelModes): Promise<void> {
  const env = loadEnv();
  const starts: Array<Promise<void>> = [];
  const requestedCount =
    (modes.feishu ? 1 : 0) + (modes.telegram ? 1 : 0) + (modes.discord ? 1 : 0);

  function shouldFailOnMissingConfig(): boolean {
    return requestedCount === 1;
  }

  if (modes.feishu) {
    if (!env.feishuAppId || !env.feishuAppSecret) {
      const message = [
        "Feishu 渠道未启动：缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET。",
        "可执行：`cat-crawl obsidian config set channel feishu` 完成交互配置。",
      ].join(" ");
      if (shouldFailOnMissingConfig()) {
        throw new Error(message);
      }
    } else {
      starts.push(
        startFeishuBridge({ ...env, feishuEnabled: true }).then(() => {
          // no-op
        }),
      );
    }
  }
  if (modes.telegram) {
    if (!env.telegramBotToken) {
      const message = [
        "Telegram 渠道未启动：缺少 TELEGRAM_BOT_TOKEN。",
        "可执行：`cat-crawl obsidian config set channel telegram` 完成交互配置。",
      ].join(" ");
      if (shouldFailOnMissingConfig()) {
        throw new Error(message);
      }
    } else {
      starts.push(
        startTelegramPollingChannel({ ...env, telegramEnabled: true }).then(() => {
          // no-op
        }),
      );
    }
  }
  if (modes.discord) {
    if (!env.discordBotToken) {
      const message = [
        "Discord 渠道未启动：缺少 DISCORD_BOT_TOKEN。",
        "可执行：`cat-crawl obsidian config set channel discord` 完成交互配置。",
      ].join(" ");
      if (shouldFailOnMissingConfig()) {
        throw new Error(message);
      }
    } else {
      starts.push(
        startDiscordBridge({ ...env, discordEnabled: true }).then(() => {
          // no-op
        }),
      );
    }
  }

  if (starts.length === 0) {
    throw new Error("没有可启动的渠道：请先完成至少一个渠道配置。");
  }

  await Promise.all(starts);
}

async function runCliMode(input: string): Promise<void> {
  const result = await runAgent(input, {
    context: {
      channel: "cli",
    },
  });
  logger.log(result.reply);
  if (result.usedTools.length > 0) {
    logger.log(`Used tools: ${result.usedTools.join(", ")}`);
  }
}

async function main() {
  const args = parseArgs();
  if (isVersionCommand(args)) {
    process.stdout.write(`v${getCliVersion()}\n`);
    return;
  }
  const obsidianCommand = parseObsidianCommand(args);
  if (!obsidianCommand) {
    printUsage();
    process.exit(1);
  }

  if (obsidianCommand.action === "pairingApprove") {
    handlePairingApproveCommand(obsidianCommand.command);
    return;
  }

  if (obsidianCommand.action === "config") {
    await handleSetGetCommand(obsidianCommand.command);
    return;
  }

  if (obsidianCommand.action === "run") {
    await runCliMode(obsidianCommand.input);
    return;
  }

  const modes = resolveModes(obsidianCommand.modes);
  await startChannels(modes);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  logger.error(`Fatal error: ${detail}`);
  process.exit(1);
});
