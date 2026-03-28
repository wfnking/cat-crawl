import type { ArticleCrawlerStrategy } from "../types.js";
import { genericCrawler } from "./generic.js";
import { wechatCrawler } from "./wechat.js";

export const sourceCrawlers: ArticleCrawlerStrategy[] = [wechatCrawler];
export const fallbackCrawler = genericCrawler;

export { genericCrawler, wechatCrawler };
