export type CaseStudyCrawlCommand = {
  action: "crawl";
  url: string;
  site?: string;
  page?: string;
  session?: string;
};

export type CaseStudyBuildCommand = {
  action: "build";
};

export type CaseStudyServeCommand = {
  action: "serve";
};

export type CaseStudyCommand =
  | CaseStudyCrawlCommand
  | CaseStudyBuildCommand
  | CaseStudyServeCommand;

function readOption(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1]?.trim() || undefined;
}

export function parseCaseStudyCommand(args: string[]): CaseStudyCommand | null {
  if (args[0] !== "case-study") {
    return null;
  }

  const action = args[1]?.trim().toLowerCase();
  if (action === "build") {
    return { action: "build" };
  }
  if (action === "serve") {
    return { action: "serve" };
  }
  if (action === "crawl") {
    const url = args[2]?.trim();
    if (!url) {
      throw new Error("Usage: cat-crawl case-study crawl <url> [--site <slug>] [--page <slug>] [--session <path>]");
    }
    return {
      action: "crawl",
      url,
      site: readOption(args, "--site"),
      page: readOption(args, "--page"),
      session: readOption(args, "--session"),
    };
  }

  throw new Error("Usage: cat-crawl case-study <crawl|build|serve> ...");
}
