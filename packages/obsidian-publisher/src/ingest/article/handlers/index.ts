import type { ArticleHandler } from "../types.js";
import { BaiduHandler } from "./baidu.js";
import { ChatGPTHandler } from "./chatgpt.js";
import { CsdnHandler } from "./csdn.js";
import { GenericHandler } from "./generic.js";
import { GoogleSearchHandler } from "./google-search.js";
import { HuxiuHandler } from "./huxiu.js";
import { RedditHandler } from "./reddit.js";
import { TencentHandler } from "./tencent.js";
import { WechatHandler } from "./wechat.js";
import { XHandler } from "./x.js";
import { ZhihuHandler } from "./zhihu.js";

export const googleSearchHandler = new GoogleSearchHandler();
export const wechatHandler = new WechatHandler();
export const huxiuHandler = new HuxiuHandler();
export const xHandler = new XHandler();
export const redditHandler = new RedditHandler();
export const chatgptHandler = new ChatGPTHandler();
export const baiduHandler = new BaiduHandler();
export const zhihuHandler = new ZhihuHandler();
export const tencentHandler = new TencentHandler();
export const csdnHandler = new CsdnHandler();
export const genericHandler = new GenericHandler();

export const articleHandlers: ArticleHandler[] = [
  googleSearchHandler,
  wechatHandler,
  huxiuHandler,
  xHandler,
  redditHandler,
  chatgptHandler,
  baiduHandler,
  zhihuHandler,
  tencentHandler,
  csdnHandler,
];

export const fallbackArticleHandler = genericHandler;
