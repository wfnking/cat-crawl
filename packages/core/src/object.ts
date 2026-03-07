export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = asObject(parent[key]);
  if (existing) {
    return existing;
  }
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}
