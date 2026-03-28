import type { ArticleCrawlerStrategy } from "../types.js";
import { genericCrawler } from "./generic.js";
import { wechatCrawler } from "./wechat.js";
import { xCrawler } from "./x.js";

export const sourceCrawlers: ArticleCrawlerStrategy[] = [wechatCrawler, xCrawler];
export const fallbackCrawler = genericCrawler;

export { genericCrawler, wechatCrawler, xCrawler };
