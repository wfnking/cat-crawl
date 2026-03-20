export type TranscriptSegment = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type VideoChapter = {
  title: string;
  startSeconds: number;
  content: string;
  translatedTitle?: string;
  translatedContent?: string;
};

export type VideoChapterCandidate = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  rawText: string;
  segments: TranscriptSegment[];
};

type SummarizeChapterInput = {
  index: number;
  sourceUrl: string;
  startSeconds: number;
  endSeconds: number;
  rawText: string;
  segments: TranscriptSegment[];
};

type SummarizeChapterFn = (
  input: SummarizeChapterInput,
) => Promise<{ title: string; body: string; translatedTitle?: string; translatedBody?: string }>;

type SummarizeChaptersFn = (input: {
  sourceUrl: string;
  chapters: VideoChapterCandidate[];
}) => Promise<Array<{
  title: string;
  startSeconds?: number;
  body: string;
  translatedTitle?: string;
  translatedBody?: string;
}>>;

type ReadableVideoMarkdownInput = {
  sourceUrl: string;
  transcriptText: string;
  transcriptSrt?: string;
  summarizeChapters?: SummarizeChaptersFn;
  summarizeChapter?: SummarizeChapterFn;
};

function parseSrtTimestamp(value: string): number {
  const matched = value.trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!matched) {
    return 0;
  }
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  const seconds = Number(matched[3]);
  const milliseconds = Number(matched[4]);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function normalizeTranscriptText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

export function parseSrt(srt: string): TranscriptSegment[] {
  return srt
    .trim()
    .split(/\r?\n\r?\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => block.split(/\r?\n/g))
    .map((lines) => {
      const index = Number(lines[0]?.trim() || "0");
      const range = lines[1]?.trim() || "";
      const matched = range.match(/^(.+?)\s+-->\s+(.+)$/);
      if (!matched) {
        return null;
      }
      const text = normalizeTranscriptText(lines.slice(2).join(" "));
      if (!text) {
        return null;
      }
      return {
        index,
        startSeconds: parseSrtTimestamp(matched[1] || ""),
        endSeconds: parseSrtTimestamp(matched[2] || ""),
        text,
      };
    })
    .filter((item): item is TranscriptSegment => Boolean(item));
}

function formatSecondsForDisplay(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isYouTubeUrl(sourceUrl: string): boolean {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

function buildYouTubeTimestampUrl(sourceUrl: string, seconds: number): string {
  const url = new URL(sourceUrl);
  url.searchParams.set("t", `${Math.max(0, Math.floor(seconds))}s`);
  return url.toString();
}

function chunkTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const groups: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let currentChars = 0;
  let currentStart = 0;

  for (const segment of segments) {
    if (current.length === 0) {
      current = [segment];
      currentChars = segment.text.length;
      currentStart = segment.startSeconds;
      continue;
    }

    const last = current[current.length - 1];
    const gap = segment.startSeconds - last.endSeconds;
    const duration = segment.endSeconds - currentStart;
    const nextChars = currentChars + segment.text.length;
    const shouldSplit = gap >= 18 || duration >= 150 || nextChars >= 700;

    if (shouldSplit) {
      groups.push(current);
      current = [segment];
      currentChars = segment.text.length;
      currentStart = segment.startSeconds;
    } else {
      current.push(segment);
      currentChars = nextChars;
    }
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function fallbackChapterTitle(index: number): string {
  return `章节 ${index + 1}`;
}

function shouldRenderTranslation(chapter: VideoChapter): boolean {
  const translatedTitle = chapter.translatedTitle?.trim();
  const translatedContent = chapter.translatedContent?.trim();
  if (!translatedTitle || !translatedContent) {
    return false;
  }

  const sourceText = `${chapter.title} ${chapter.content}`.trim();
  const latinMatches = sourceText.match(/[A-Za-z]/g) || [];
  const cjkMatches = sourceText.match(/[\u3400-\u9fff]/g) || [];

  if (latinMatches.length === 0) {
    return false;
  }
  if (cjkMatches.length > latinMatches.length / 2) {
    return false;
  }
  return true;
}

function appendChapterBody(lines: string[], chapter: VideoChapter, renderTranslate: boolean): void {
  if (renderTranslate && chapter.translatedContent) {
    const origParas = chapter.content.trim().split(/\n\n+/);
    const transParas = chapter.translatedContent.trim().split(/\n\n+/);

    if (origParas.length === transParas.length) {
      for (let i = 0; i < origParas.length; i++) {
        lines.push(origParas[i]!);
        lines.push(transParas[i]!);
        lines.push("");
      }
      return;
    }

    lines.push(chapter.content.trim());
    lines.push("");
    lines.push(chapter.translatedContent.trim());
    lines.push("");
    return;
  }

  lines.push(chapter.content.trim());
  lines.push("");
}

export function buildChapterMarkdown(sourceUrl: string, chapters: VideoChapter[]): string {
  const lines: string[] = [`- Source: ${sourceUrl}`, ""];
  for (const chapter of chapters) {
    const renderTranslate = shouldRenderTranslation(chapter) && Boolean(chapter.translatedContent?.trim());
    const displayTitle = renderTranslate && chapter.translatedTitle?.trim()
      ? `${chapter.title} / ${chapter.translatedTitle.trim()}`
      : chapter.title;

    if (isYouTubeUrl(sourceUrl)) {
      lines.push(`## [${displayTitle}](${buildYouTubeTimestampUrl(sourceUrl, chapter.startSeconds)})`);
    } else {
      lines.push(`## ${displayTitle}（${formatSecondsForDisplay(chapter.startSeconds)}）`);
    }
    lines.push("");
    appendChapterBody(lines, chapter, renderTranslate);
  }
  return lines.join("\n").trim();
}

function buildUntimedChapterMarkdown(sourceUrl: string, chapters: VideoChapter[]): string {
  const lines: string[] = [`- Source: ${sourceUrl}`, ""];
  for (const chapter of chapters) {
    const renderTranslate = shouldRenderTranslation(chapter) && Boolean(chapter.translatedContent?.trim());
    const displayTitle =
      renderTranslate && chapter.translatedTitle?.trim()
        ? `${chapter.title} / ${chapter.translatedTitle.trim()}`
        : chapter.title;

    lines.push(`## ${displayTitle}`);
    lines.push("");
    appendChapterBody(lines, chapter, renderTranslate);
  }
  return lines.join("\n").trim();
}

function buildPlainTranscriptMarkdown(sourceUrl: string, transcriptText: string): string {
  return [`- Source: ${sourceUrl}`, "", transcriptText.trim()].join("\n").trim();
}

function buildCandidateChapters(groups: TranscriptSegment[][]): VideoChapterCandidate[] {
  return groups.map((group, index) => {
    const rawText = normalizeTranscriptText(group.map((segment) => segment.text).join(" "));
    const startSeconds = group[0]?.startSeconds || 0;
    const endSeconds = group[group.length - 1]?.endSeconds || startSeconds;
    return {
      index,
      startSeconds,
      endSeconds,
      rawText,
      segments: group,
    };
  });
}

function getTargetChapterCount(candidates: VideoChapterCandidate[]): number {
  if (candidates.length <= 1) {
    return candidates.length;
  }
  const totalDuration =
    (candidates[candidates.length - 1]?.endSeconds || 0) - (candidates[0]?.startSeconds || 0);
  const durationBased = Math.ceil(totalDuration / 120) + 2;
  return Math.max(3, Math.min(8, durationBased));
}

function coalesceCandidateChapters(candidates: VideoChapterCandidate[]): VideoChapterCandidate[] {
  const targetCount = getTargetChapterCount(candidates);
  if (candidates.length <= targetCount) {
    return candidates;
  }

  const chunkSize = Math.ceil(candidates.length / targetCount);
  const merged: VideoChapterCandidate[] = [];

  for (let start = 0; start < candidates.length; start += chunkSize) {
    const slice = candidates.slice(start, start + chunkSize);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (!first || !last) {
      continue;
    }
    const segments = slice.flatMap((candidate) => candidate.segments);
    merged.push({
      index: merged.length,
      startSeconds: first.startSeconds,
      endSeconds: last.endSeconds,
      rawText: normalizeTranscriptText(slice.map((candidate) => candidate.rawText).join(" ")),
      segments,
    });
  }

  return merged;
}

export async function createReadableVideoMarkdown(
  input: ReadableVideoMarkdownInput,
): Promise<string> {
  const segments = input.transcriptSrt ? parseSrt(input.transcriptSrt) : [];
  if (segments.length === 0) {
    if (input.summarizeChapters) {
      const rawText = input.transcriptText.trim();
      if (rawText) {
        const untimedCandidates: VideoChapterCandidate[] = [
          {
            index: 0,
            startSeconds: 0,
            endSeconds: 0,
            rawText,
            segments: [
              {
                index: 1,
                startSeconds: 0,
                endSeconds: 0,
                text: rawText,
              },
            ],
          },
        ];
        const summarized = await input.summarizeChapters({
          sourceUrl: input.sourceUrl,
          chapters: untimedCandidates,
        });
        if (summarized.length === 0) {
          throw new Error("chapter summarize returned empty result");
        }

        const untimedChapters: VideoChapter[] = [];
        const canUseDirectSummaries = summarized.length !== untimedCandidates.length;

        if (canUseDirectSummaries) {
          for (const [index, summary] of summarized.entries()) {
            const fallback = untimedCandidates[Math.min(index, untimedCandidates.length - 1)];
            untimedChapters.push({
              title: summary?.title?.trim() || fallbackChapterTitle(index),
              startSeconds: summary?.startSeconds ?? fallback?.startSeconds ?? 0,
              content: summary?.body?.trim() || normalizeTranscriptText(fallback?.rawText || ""),
              translatedTitle: summary?.translatedTitle?.trim() || undefined,
              translatedContent: summary?.translatedBody?.trim() || undefined,
            });
          }
        } else {
          for (const [index, candidate] of untimedCandidates.entries()) {
            const summary = summarized[index];
            untimedChapters.push({
              title: summary?.title?.trim() || fallbackChapterTitle(index),
              startSeconds: summary?.startSeconds ?? candidate.startSeconds,
              content: summary?.body?.trim() || normalizeTranscriptText(candidate.rawText),
              translatedTitle: summary?.translatedTitle?.trim() || undefined,
              translatedContent: summary?.translatedBody?.trim() || undefined,
            });
          }
        }

        return buildUntimedChapterMarkdown(input.sourceUrl, untimedChapters);
      }
    }
    return buildPlainTranscriptMarkdown(input.sourceUrl, input.transcriptText);
  }

  const candidates = input.summarizeChapters
    ? [
        {
          index: 0,
          startSeconds: segments[0]?.startSeconds || 0,
          endSeconds: segments[segments.length - 1]?.endSeconds || segments[0]?.startSeconds || 0,
          rawText: normalizeTranscriptText(segments.map((segment) => segment.text).join(" ")),
          segments,
        },
      ]
    : coalesceCandidateChapters(buildCandidateChapters(chunkTranscriptSegments(segments)));
  const chapters: VideoChapter[] = [];

  if (input.summarizeChapters) {
    const summarized = await input.summarizeChapters({
      sourceUrl: input.sourceUrl,
      chapters: candidates,
    });
    if (summarized.length === 0) {
      throw new Error("chapter summarize returned empty result");
    }

    const canUseDirectSummaries = summarized.length !== candidates.length;
    if (canUseDirectSummaries) {
      for (const [index, summary] of summarized.entries()) {
        chapters.push({
          title: summary?.title?.trim() || fallbackChapterTitle(index),
          startSeconds:
            summary?.startSeconds ??
            candidates[Math.min(index, candidates.length - 1)]?.startSeconds ??
            0,
          content:
            summary?.body?.trim() ||
            normalizeTranscriptText(candidates[Math.min(index, candidates.length - 1)]?.rawText || ""),
          translatedTitle: summary?.translatedTitle?.trim() || undefined,
          translatedContent: summary?.translatedBody?.trim() || undefined,
        });
      }
    } else {
      for (const [index, candidate] of candidates.entries()) {
        const summary = summarized[index];
        chapters.push({
          title: summary?.title?.trim() || fallbackChapterTitle(index),
          startSeconds: summary?.startSeconds ?? candidate.startSeconds,
          content:
            summary?.body?.trim() || normalizeTranscriptText(candidate.rawText),
          translatedTitle: summary?.translatedTitle?.trim() || undefined,
          translatedContent: summary?.translatedBody?.trim() || undefined,
        });
      }
    }
    return buildChapterMarkdown(input.sourceUrl, chapters);
  }

  for (const candidate of candidates) {
    const { index, startSeconds, endSeconds, rawText, segments: chapterSegments } = candidate;
    let title = fallbackChapterTitle(index);
    let content = normalizeTranscriptText(rawText);

    if (input.summarizeChapter) {
      try {
        const result = await input.summarizeChapter({
          index,
          sourceUrl: input.sourceUrl,
          startSeconds,
          endSeconds,
          rawText,
          segments: chapterSegments,
        });
        title = result.title.trim() || title;
        content = result.body.trim() || content;
        const translatedTitle = result.translatedTitle?.trim();
        const translatedContent = result.translatedBody?.trim();
        chapters.push({
          title,
          startSeconds,
          content,
          translatedTitle: translatedTitle || undefined,
          translatedContent: translatedContent || undefined,
        });
        continue;
      } catch {
        // fallback to raw chunk content
      }
    }

    chapters.push({
      title,
      startSeconds,
      content,
    });
  }

  return buildChapterMarkdown(input.sourceUrl, chapters);
}

export const __test__ = {
  buildChapterMarkdown,
  buildCandidateChapters,
  coalesceCandidateChapters,
  chunkTranscriptSegments,
  formatSecondsForDisplay,
  parseSrt,
  parseSrtTimestamp,
  shouldRenderTranslation,
};
