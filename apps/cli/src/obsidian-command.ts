export type ChannelModes = {
  feishu: boolean;
  telegram: boolean;
  discord: boolean;
};

export type SetGetCommand = {
  action: "set" | "get";
  key: string;
  value?: string;
};

export type PairingApproveCommand = {
  channel: "telegram";
  code: string;
};

export type ObsidianCommand =
  | {
      action: "start";
      modes: ChannelModes;
    }
  | {
      action: "run";
      input: string;
    }
  | {
      action: "config";
      command: SetGetCommand;
    }
  | {
      action: "pairingApprove";
      command: PairingApproveCommand;
    };

const CHANNEL_FLAGS = new Set(["--feishu", "--telegram", "--discord", "--all-channels"]);

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

function parseConfigCommand(args: string[]): SetGetCommand {
  const action = args[0]?.trim().toLowerCase();
  if (action !== "set" && action !== "get") {
    throw new Error("Usage: cat-crawl obsidian config <set|get> <key> [value]");
  }

  return {
    action,
    key: args[1]?.trim() || "",
    value: args[2]?.trim(),
  };
}

function parsePairingApproveCommand(args: string[]): PairingApproveCommand {
  const subAction = args[0]?.trim().toLowerCase();
  const channel = args[1]?.trim().toLowerCase();
  if (subAction !== "approve" || channel !== "telegram") {
    throw new Error("Usage: cat-crawl obsidian pairing approve telegram <code>");
  }
  const code = args[2]?.trim();
  if (!code) {
    throw new Error("Usage: cat-crawl obsidian pairing approve telegram <code>");
  }
  return {
    channel: "telegram",
    code,
  };
}

function parseStartCommand(args: string[]): ChannelModes {
  for (const arg of args) {
    if (!CHANNEL_FLAGS.has(arg)) {
      throw new Error(
        "Usage: cat-crawl obsidian start [--feishu|--telegram|--discord|--all-channels]",
      );
    }
  }
  return parseExplicitModes(args);
}

export function hasAnyChannelMode(modes: ChannelModes): boolean {
  return modes.feishu || modes.telegram || modes.discord;
}

export function parseObsidianCommand(args: string[]): ObsidianCommand | null {
  if (args[0] !== "obsidian") {
    return null;
  }

  const action = args[1]?.trim().toLowerCase();
  if (action === "start") {
    return {
      action: "start",
      modes: parseStartCommand(args.slice(2)),
    };
  }

  if (action === "run") {
    const input = args
      .slice(2)
      .join(" ")
      .trim();
    if (!input) {
      throw new Error('Usage: cat-crawl obsidian run "你的消息内容或文章链接"');
    }
    return {
      action: "run",
      input,
    };
  }

  if (action === "config") {
    return {
      action: "config",
      command: parseConfigCommand(args.slice(2)),
    };
  }

  if (action === "pairing") {
    return {
      action: "pairingApprove",
      command: parsePairingApproveCommand(args.slice(2)),
    };
  }

  throw new Error(
    [
      "Usage:",
      "1) cat-crawl case-study <crawl|build|serve> ...",
      "2) cat-crawl obsidian start [--feishu|--telegram|--discord|--all-channels]",
      '3) cat-crawl obsidian run "你的消息内容或文章链接"',
      "4) cat-crawl obsidian config set channel telegram",
      "5) cat-crawl obsidian config get channel [fallback]",
      "6) cat-crawl obsidian config set agent deepseek|gemini",
      "7) cat-crawl obsidian config get agent [fallback]",
      "8) cat-crawl obsidian pairing approve telegram <code>",
    ].join("\n"),
  );
}
