import type { ChannelConfigValue } from "./local-config.js";

export type GatewaySetupStep = {
  key: string;
  label: string;
  required: boolean;
  defaultValue?: string;
  shouldAsk?: (answers: Record<string, string>, existing: Record<string, string>) => boolean;
};

export function getGatewaySetupSteps(channel: ChannelConfigValue): GatewaySetupStep[] {
  if (channel === "telegram") {
    return [
      {
        key: "TELEGRAM_BOT_TOKEN",
        label: "Telegram Bot Token",
        required: true,
      },
      {
        key: "TELEGRAM_DM_POLICY",
        label: "Telegram DM Policy",
        required: true,
        defaultValue: "pairing",
      },
      {
        key: "TELEGRAM_GROUP_POLICY",
        label: "Telegram Group Policy",
        required: true,
        defaultValue: "allowlist",
      },
      {
        key: "TELEGRAM_STREAM_MODE",
        label: "Telegram Stream Mode",
        required: true,
        defaultValue: "partial",
      },
    ];
  }

  if (channel === "discord") {
    return [
      {
        key: "DISCORD_BOT_TOKEN",
        label: "Discord Bot Token",
        required: true,
      },
      {
        key: "DISCORD_GROUP_POLICY",
        label: "Discord Group Policy",
        required: true,
        defaultValue: "allowlist",
      },
    ];
  }

  if (channel === "feishu") {
    return [
      {
        key: "FEISHU_APP_ID",
        label: "Feishu App ID",
        required: true,
      },
      {
        key: "FEISHU_APP_SECRET",
        label: "Feishu App Secret",
        required: true,
      },
      {
        key: "FEISHU_DOMAIN",
        label: "Feishu Domain (feishu/lark)",
        required: true,
        defaultValue: "feishu",
      },
    ];
  }

  return [];
}

export function buildGatewaySetupConfig(
  channel: ChannelConfigValue,
  answers: Record<string, string>,
): Record<string, string> {
  const output: Record<string, string> = {
    channel,
    FEISHU_ENABLED: channel === "feishu" || channel === "all" ? "true" : "false",
    TELEGRAM_ENABLED: channel === "telegram" || channel === "all" ? "true" : "false",
    DISCORD_ENABLED: channel === "discord" || channel === "all" ? "true" : "false",
  };

  if (channel === "telegram" || channel === "all") {
    output.TELEGRAM_DM_POLICY = answers.TELEGRAM_DM_POLICY?.trim() || "pairing";
    output.TELEGRAM_GROUP_POLICY = answers.TELEGRAM_GROUP_POLICY?.trim() || "allowlist";
    output.TELEGRAM_STREAM_MODE = answers.TELEGRAM_STREAM_MODE?.trim() || "partial";
  }
  if (channel === "discord" || channel === "all") {
    output.DISCORD_GROUP_POLICY = answers.DISCORD_GROUP_POLICY?.trim() || "allowlist";
  }

  for (const [key, value] of Object.entries(answers)) {
    if (
      key === "TELEGRAM_DM_POLICY" ||
      key === "TELEGRAM_GROUP_POLICY" ||
      key === "TELEGRAM_STREAM_MODE" ||
      key === "DISCORD_GROUP_POLICY"
    ) {
      continue;
    }
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    output[key] = normalized;
  }

  return output;
}
