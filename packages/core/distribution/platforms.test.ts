import { afterEach, describe, expect, it, vi } from "vitest";
import { findPlatformTab, isPlatformEditorUrl, isPlatformSiteUrl } from "./platforms";

afterEach(() => vi.unstubAllGlobals());

describe("distribution target routing", () => {
  it.each([
    ["wechat", "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123"],
    ["zhihu", "https://zhuanlan.zhihu.com/write"],
    ["zhihu", "https://zhuanlan.zhihu.com/p/123/edit"],
    ["juejin", "https://juejin.cn/editor/drafts/new"],
    ["zsxq", "https://wx.zsxq.com/article?groupId=123"],
    ["zsxq", "https://wx.zsxq.com/dweb/#/group/123"],
  ] as const)("accepts the %s article editor", (platform, url) => {
    expect(isPlatformEditorUrl(platform, url)).toBe(true);
    expect(isPlatformEditorUrl(platform, url.replace("https:", "http:"))).toBe(false);
  });

  it("rejects home pages, answers, small green books and lookalike domains", () => {
    expect(isPlatformEditorUrl("wechat", "https://mp.weixin.qq.com/")).toBe(false);
    expect(
      isPlatformEditorUrl("wechat", "https://mp.weixin.qq.com/cgi-bin/appmsg?createType=8"),
    ).toBe(false);
    expect(
      isPlatformEditorUrl("wechat", "https://mp.weixin.qq.com/cgi-bin/appmsg?createtype=8"),
    ).toBe(false);
    expect(isPlatformEditorUrl("zhihu", "https://www.zhihu.com/question/123")).toBe(false);
    expect(isPlatformSiteUrl("zhihu", "https://zhuanlan.zhihu.com.evil.example/write")).toBe(false);
    expect(isPlatformEditorUrl("zsxq", "https://evil.example/article?groupId=123")).toBe(false);
  });

  it("reuses the Zhihu login redirect without treating it as an editor", async () => {
    const url = "https://www.zhihu.com/signin?next=http%3A%2F%2Fzhuanlan.zhihu.com%2Fwrite";
    vi.stubGlobal("browser", { tabs: { query: vi.fn().mockResolvedValue([{ id: 5, url }]) } });
    expect(await findPlatformTab("zhihu", 5)).toBe(5);
    expect(isPlatformEditorUrl("zhihu", url)).toBe(false);
    expect(isPlatformEditorUrl("zhihu", "https://www.zhihu.com/write")).toBe(false);
  });

  it("finds an editor opened in a new tab after login, ahead of the stored portal", async () => {
    vi.stubGlobal("browser", {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 2, url: "https://mp.weixin.qq.com/", lastAccessed: 100 },
          { id: 3, url: "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit", lastAccessed: 90 },
          { id: 4, url: "https://juejin.cn/editor/drafts/new", lastAccessed: 200 },
        ]),
      },
    });
    expect(await findPlatformTab("wechat", 2)).toBe(3);
    expect(await findPlatformTab("juejin", 3)).toBe(4);
    expect(await findPlatformTab("zhihu", 3)).toBeUndefined();
  });
});
