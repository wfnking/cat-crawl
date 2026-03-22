export function shouldForceRecrawlFromText(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) {
    return false;
  }

  return /(重新爬|重爬|重抓|重新抓取|重新处理|强制重爬|强制重抓|忽略历史|忽略重复|即使爬过|重新来一次|force recrawl|re-crawl|recrawl|reprocess)/i.test(
    text,
  );
}
