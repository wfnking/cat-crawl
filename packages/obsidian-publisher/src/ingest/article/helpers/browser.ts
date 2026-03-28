export const BROWSER_SCRAPE_FUNCTION_SOURCE = String.raw`function(currentAdapter) {
  const meta = (name, attr = 'name') =>
    document.querySelector('meta[' + attr + '="' + name + '"]')?.getAttribute('content')?.trim() || null;
  const text = (selectors) => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.trim();
      if (value) {
        return value;
      }
    }
    return null;
  };
  const html = (selectors) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement) {
        return node;
      }
    }
    return null;
  };

  const selectorMap = {
    huxiu: [
      '.article-content',
      '.article__content',
      '.detail-content',
      '.article-wrap',
      'article',
      'main article',
      'main',
    ],
    baidu: ['article', '.article-content', '.mainContent', 'main'],
    reddit: ['shreddit-post', 'article', 'main'],
    chatgpt: ['main', '[data-message-author-role="assistant"]'],
    csdn: ['#content_views', '#article_content', '.blog-content-box', 'main'],
    tencent: ['.mod-content__markdown', '.mod-content', '.cdc-article__body', 'main'],
    zhihu: ['.QuestionAnswer-content', '.RichContent-inner', 'article', 'main'],
    x: ['article[data-testid="tweet"]', 'main'],
    generic: [
      'article',
      "[itemprop='articleBody']",
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content',
      'main',
    ],
  };

  const title =
    meta('og:title', 'property') ||
    meta('twitter:title', 'name') ||
    text(['#activity-name', 'h1', '.QuestionHeader-title', '.article-title', '.title']) ||
    document.title ||
    'Untitled';

  let author =
    text([
      '#js_name',
      '.account_nickname_inner',
      '.AuthorInfo-name .UserLink-link',
      '.author-info__username',
      '.follow-nickName',
      '.mod-article-source__name',
      '.AuthorInfo-name',
      '.UserLink-link',
      '.author-name',
      '.author',
      "[rel='author']",
    ]) || meta('author', 'name');

  if (currentAdapter === 'zhihu') {
    const zhihuAuthor =
      document.querySelector('.AuthorInfo-name .UserLink-link')?.textContent?.trim() ||
      document.querySelector('.AuthorInfo-name')?.textContent?.trim() ||
      '';
    if (zhihuAuthor) {
      author = zhihuAuthor;
    }
  }

  const publishedRaw =
    text([
      'time',
      '.article-time',
      '.publish-time',
      '.article-time-box',
      '.mod-header__detail',
      '.ContentItem-time',
      '.ContentItem-time span',
      '.time',
      "[data-role='publish-time']",
    ]) ||
    meta('article:published_time', 'property') ||
    meta('dateCreated', 'itemprop') ||
    meta('dateModified', 'itemprop') ||
    meta('publishdate', 'name') ||
    meta('pubdate', 'name');

  const buildXMarkdown = () => {
    const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    if (tweets.length === 0) {
      return {
        markdown: '',
        author: null,
        publishedRaw: null,
      };
    }

    const sections = [];
    let firstAuthor = null;
    let firstPublishedRaw = null;

    for (let index = 0; index < tweets.length; index += 1) {
      const tweet = tweets[index];
      const userNameText =
        tweet.querySelector('[data-testid="User-Name"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const handleMatch = userNameText.match(/@[A-Za-z0-9_]+/);
      const tweetAuthor = (handleMatch?.[0] || userNameText || '').trim();
      if (!firstAuthor && tweetAuthor) {
        firstAuthor = tweetAuthor;
      }

      const timeEl = tweet.querySelector('time');
      const tweetTime = timeEl?.getAttribute('datetime')?.trim() || timeEl?.textContent?.trim() || '';
      if (!firstPublishedRaw && tweetTime) {
        firstPublishedRaw = tweetTime;
      }

      const tweetText = Array.from(tweet.querySelectorAll('[data-testid="tweetText"]'))
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean)
        .join('\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (!tweetText) {
        continue;
      }

      const mediaUrls = Array.from(tweet.querySelectorAll('img'))
        .map((node) => node.getAttribute('src')?.trim() || '')
        .filter((src) => /twimg\.com\/media\//i.test(src));
      const uniqueMediaUrls = Array.from(new Set(mediaUrls));
      const mediaMarkdown = uniqueMediaUrls
        .map((src, mediaIndex) => '![Image ' + (mediaIndex + 1) + '](' + src + ')')
        .join('\n\n');

      const titleParts = [tweetAuthor, tweetTime].filter(Boolean);
      const sectionTitle = titleParts.join(' · ') || 'Tweet ' + (index + 1);
      sections.push(['## ' + sectionTitle, '', tweetText, mediaMarkdown].filter(Boolean).join('\n').trim());
    }

    return {
      markdown: sections.join('\n\n').trim(),
      author: firstAuthor,
      publishedRaw: firstPublishedRaw,
    };
  };

  const contentSelectors = selectorMap[currentAdapter] || selectorMap.generic;
  const contentNode = html(contentSelectors);
  const contentHtml = contentNode?.innerHTML?.trim() || '';

  const xStructured = currentAdapter === 'x' ? buildXMarkdown() : null;

  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || null;

  return {
    title,
    author: author || null,
    published: xStructured?.publishedRaw || publishedRaw || null,
    publishedTimestamp: null,
    contentHtml,
    xContentMarkdown: xStructured?.markdown || '',
    carouselImages: [],
    canonical,
  };
}`;

export function createBrowserScrapeFunction<TArgs extends unknown[] = unknown[], TResult = unknown>(
  source: string,
): (...args: TArgs) => TResult {
  return Function(`return (${source});`)() as (...args: TArgs) => TResult;
}
