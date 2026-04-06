function parsePathSegments(path: string): string[] {
  return path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function getConfigValueByPath(root: unknown, path: string): unknown {
  const segments = parsePathSegments(path);
  if (segments.length === 0) {
    return undefined;
  }

  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function formatConfigValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}
