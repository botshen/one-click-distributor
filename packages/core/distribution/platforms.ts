import { isJuejinEditorUrl, JUEJIN_EDITOR_URL } from "./juejin";

export type PlatformId = "wechat" | "zhihu" | "juejin" | "zsxq";
export type RichTextPlatformId = Exclude<PlatformId, "juejin">;
export interface PlatformFillResult {
  success: boolean;
  message: string;
  warnings?: string[];
}

export const DISTRIBUTION_PLATFORMS = [
  {
    id: "wechat",
    name: "微信公众号",
    description: "富文本图文",
    icon: "/platforms/wechat.png",
    editorUrl: "https://mp.weixin.qq.com/",
    instructions: "登录公众号后台，打开一篇图文的编辑页，再返回工作台填稿。",
    contentLabel: "富文本正文，外链图片转存到公众号图床",
  },
  {
    id: "zhihu",
    name: "知乎",
    description: "专栏文章",
    icon: "/platforms/zhihu.png",
    editorUrl: "https://zhuanlan.zhihu.com/write",
    instructions: "登录知乎并打开专栏文章编辑页，再返回工作台填稿。",
    contentLabel: "富文本正文，外链图片通过编辑器上传",
  },
  {
    id: "juejin",
    name: "掘金",
    description: "Markdown 文章",
    icon: "/platforms/juejin.png",
    editorUrl: JUEJIN_EDITOR_URL,
    instructions: "登录掘金并打开文章编辑页，再返回工作台填稿。",
    contentLabel: "Markdown 正文",
  },
  {
    id: "zsxq",
    name: "知识星球",
    description: "星球长文章",
    icon: "/platforms/zsxq.ico",
    editorUrl: "https://wx.zsxq.com/",
    instructions: "登录知识星球，选择星球并打开带标题的长文章编辑器，再返回工作台填稿。",
    contentLabel: "富文本正文，列表转为编号或项目符号段落",
  },
] as const;

export function getDistributionPlatform(id: PlatformId) {
  const platform = DISTRIBUTION_PLATFORMS.find((item) => item.id === id);
  if (!platform) throw new Error("未知的填稿平台");
  return platform;
}

export function isPlatformSiteUrl(id: PlatformId, url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === new URL(getDistributionPlatform(id).editorUrl).hostname ||
        (id === "zhihu" && parsed.hostname === "www.zhihu.com"))
    );
  } catch {
    return false;
  }
}

export function isPlatformEditorUrl(id: PlatformId, url: string | undefined): boolean {
  if (!url || !isPlatformSiteUrl(id, url)) return false;
  const parsed = new URL(url);
  switch (id) {
    case "juejin":
      return isJuejinEditorUrl(url);
    case "wechat":
      return (
        parsed.pathname === "/cgi-bin/appmsg" &&
        (parsed.searchParams.get("createType") ?? parsed.searchParams.get("createtype")) !== "8"
      );
    case "zhihu":
      return (
        parsed.hostname === "zhuanlan.zhihu.com" &&
        (/^\/write\/?$/.test(parsed.pathname) || /^\/p\/\d+\/edit\/?$/.test(parsed.pathname))
      );
    case "zsxq":
      return (
        parsed.pathname === "/article" ||
        parsed.pathname.startsWith("/group/") ||
        /^\/dweb\/?$/.test(parsed.pathname)
      );
  }
}

// Users may open the actual editor in a new tab from the platform's login/home page.
export async function findPlatformTab(
  id: PlatformId,
  storedTabId?: number,
): Promise<number | undefined> {
  const tabs = await browser.tabs.query({});
  const stored = tabs.find((tab) => tab.id === storedTabId);
  if (stored && isPlatformEditorUrl(id, stored.url)) return stored.id;
  const editors = tabs.filter((tab) => isPlatformEditorUrl(id, tab.url));
  editors.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return editors[0]?.id ?? (isPlatformSiteUrl(id, stored?.url) ? stored?.id : undefined);
}
