type PickPolicyFolderInput = {
  title: string;
  summary: string;
  options: string[];
};

function findOpcOption(options: string[]): string {
  for (const option of options) {
    const normalized = option.trim().toLowerCase();
    if (normalized === "opc" || normalized === "one person company") {
      return option;
    }
  }
  return "";
}

function isStartupTopic(text: string): boolean {
  return /创业|创业者|创始人|一人公司|个体创业|商业化|变现|公司经营|startup|founder|one person company|cross[- ]?border e[- ]?commerce|跨境电商|电商/i.test(
    text,
  );
}

export function pickPolicyFolder(input: PickPolicyFolderInput): string {
  const opcOption = findOpcOption(input.options);
  if (!opcOption) {
    return "";
  }
  const joined = `${input.title}\n${input.summary}`;
  if (isStartupTopic(joined)) {
    return opcOption;
  }
  return "";
}
