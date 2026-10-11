import { afterEach, describe, expect, it, vi } from "vitest";
import { fillPlatformTab } from "./fill-tab";

afterEach(() => vi.unstubAllGlobals());

describe("per-platform failure isolation", () => {
  it("returns a closed-tab failure so batch distribution can continue", async () => {
    vi.stubGlobal("browser", {
      tabs: { get: vi.fn().mockRejectedValue(new Error("No tab with id: 7")) },
    });
    const result = await fillPlatformTab("juejin", 7, { title: "测试", markdown: "正文" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("No tab");
  });
  it("does not navigate or inject anything for an empty draft", async () => {
    const get = vi.fn();
    vi.stubGlobal("browser", { tabs: { get } });
    expect((await fillPlatformTab("wechat", 7, { title: "", markdown: "正文" })).success).toBe(
      false,
    );
    expect(get).not.toHaveBeenCalled();
  });
  it("returns injection failures instead of aborting the batch", async () => {
    vi.stubGlobal("browser", {
      tabs: {
        get: vi.fn().mockResolvedValue({
          url: "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit",
          status: "complete",
        }),
      },
      scripting: { executeScript: vi.fn().mockRejectedValue(new Error("The tab was closed")) },
    });
    expect((await fillPlatformTab("wechat", 7, { title: "标题", markdown: "正文" })).success).toBe(
      false,
    );
  });
});
