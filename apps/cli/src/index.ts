#!/usr/bin/env node

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { asObject, createLogger, ensureObject } from "@cat-crawl/core";
import {
  buildCaseStudyIndexes,
  parseCaseStudyCommand,
  runCaseStudyCrawl,
  startCaseStudyServer,
} from "@cat-crawl/case-study";
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
  runWechatAgent,
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

const logger = createLogger();

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

  const flatAgentKeys = [
    "agent",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
    "DEEPSEEK_MODEL",
    "CODEX_MODEL",
    "CODEX_BIN",
  ];
  for (const key of flatAgentKeys) {
    delete raw[key];
  }

  const agentConfig = ensureObject(raw, "agent");
  agentConfig.provider = agent;
  delete agentConfig.deepseek;
  delete agentConfig.codex;

  if (agent === "deepseek") {
    const deepseek = ensureObject(agentConfig, "deepseek");
    deepseek.apiKey = values.DEEPSEEK_API_KEY || "";
    deepseek.baseUrl = values.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
    deepseek.model = values.DEEPSEEK_MODEL || "deepseek-chat";
  } else if (agent === "codex") {
    const codex = ensureObject(agentConfig, "codex");
    codex.model = values.CODEX_MODEL || "gpt-5-codex";
    codex.bin = values.CODEX_BIN || "codex";
  }

  store.writeRaw(raw);
}

function parseArgs(): string[] {
  return process.argv.slice(2);
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
      "1) cat-crawl case-study <crawl|build|serve> ...",
      "2) cat-crawl obsidian start [--feishu|--telegram|--discord|--all-channels]",
      '3) cat-crawl obsidian run "你的消息内容或文章链接"',
      "4) cat-crawl obsidian config set channel telegram",
      "5) cat-crawl obsidian config get channel [fallback]",
      "6) cat-crawl obsidian config set agent deepseek|codex",
      "7) cat-crawl obsidian config get agent [fallback]",
      "8) cat-crawl obsidian pairing approve telegram <code>",
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
        throw new Error("agent 当前只支持 deepseek / codex");
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
  logger.info("[index] channels started");
}

async function runCliMode(input: string): Promise<void> {
  const result = await runWechatAgent(input, {
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
  const caseStudyCommand = parseCaseStudyCommand(args);
  if (caseStudyCommand) {
    if (caseStudyCommand.action === "crawl") {
      const pageDir = await runCaseStudyCrawl(caseStudyCommand);
      logger.log(`case-study crawl saved to ${pageDir}`);
      return;
    }
    if (caseStudyCommand.action === "build") {
      const generatedDir = buildCaseStudyIndexes();
      logger.log(`case-study indexes built at ${generatedDir}`);
      return;
    }
    await startCaseStudyServer();
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
