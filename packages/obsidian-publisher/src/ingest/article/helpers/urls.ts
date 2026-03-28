export type ArticleImageAttrs = {
  src?: string | null;
  dataSrc?: string | null;
  dataOriginal?: string | null;
  dataOriginalSrc?: string | null;
  dataLazySrc?: string | null;
  srcset?: string | null;
};

export function normalizeUrl(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

function isInlineDataImage(url: string): boolean {
  return url.toLowerCase().startsWith("data:image/");
}

function firstSrcFromSrcset(raw: string): string {
  return raw
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0] || "")
    .filter(Boolean)[0] || "";
}

export function resolveSourceUrl(baseUrl: string, candidate: string | null | undefined): string {
  const value = candidate?.trim() || "";
  if (!value) {
    return baseUrl;
  }
  try {
    return new URL(normalizeUrl(value), baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

export function resolveArticleImageSrc(attrs: ArticleImageAttrs): string {
  const values = [
    attrs.dataSrc,
    attrs.dataOriginal,
    attrs.dataOriginalSrc,
    attrs.dataLazySrc,
    attrs.src,
    attrs.srcset ? firstSrcFromSrcset(attrs.srcset) : "",
  ]
    .map((item) => item?.trim() || "")
    .filter(Boolean);

  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (isInlineDataImage(normalized)) {
      continue;
    }
    return normalized;
  }

  return "";
}
