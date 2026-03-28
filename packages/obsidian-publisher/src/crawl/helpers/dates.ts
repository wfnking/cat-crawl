export function normalizePublishedDate(raw: string | null): string | null {
  const text = raw?.trim() || "";
  const fullDate = text.match(/(\d{4})[./\-年](\d{1,2})[./\-月](\d{1,2})/);
  if (fullDate) {
    return `${fullDate[1]}-${fullDate[2].padStart(2, "0")}-${fullDate[3].padStart(2, "0")}`;
  }
  const englishMonth = text.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})$/i,
  );
  if (englishMonth) {
    const monthMap: Record<string, string> = {
      january: "01",
      february: "02",
      march: "03",
      april: "04",
      may: "05",
      june: "06",
      july: "07",
      august: "08",
      september: "09",
      october: "10",
      november: "11",
      december: "12",
    };
    const month = monthMap[englishMonth[1].toLowerCase()];
    const day = englishMonth[2].padStart(2, "0");
    return `${englishMonth[3]}-${month}-${day}`;
  }
  return null;
}

export function formatUnixSecondsDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const numeric = Number(String(raw).trim());
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const seconds = numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  if (seconds <= 0) {
    return null;
  }
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizePublishedDateWithFallback(
  raw: string | null,
  fallbackTimestampSeconds: number | null,
): string | null {
  const normalized = normalizePublishedDate(raw);
  if (normalized) {
    return normalized;
  }

  const fallback = formatUnixSecondsDate(fallbackTimestampSeconds);
  const text = raw?.trim() || "";
  const monthDay = text.match(/(\d{1,2})[./\-月](\d{1,2})(?:日)?(?:\s+\d{1,2}:\d{2})?/);
  if (monthDay && fallback) {
    const year = fallback.slice(0, 4);
    const month = monthDay[1].padStart(2, "0");
    const day = monthDay[2].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return fallback;
}
