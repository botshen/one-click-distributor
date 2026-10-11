import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareWechatArticle, prepareWechatTab } from "./wechat-tab";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function prepare(markup: string, url: string) {
  const { document } = parseHTML(`<html><body>${markup}</body></html>`);
  return runInNewContext(`(${prepareWechatArticle.toString()})()`, {
    document,
    location: new URL(url),
    URL,
    URLSearchParams,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  });
}

describe("WeChat preparation across serialized scripts and navigation", () => {
  it("opens a new article from a logged-in home or draft list", () => {
    for (const path of ["/cgi-bin/home", "/cgi-bin/appmsg?begin=0"]) {
      const url = new URL(path, "https://mp.weixin.qq.com");
      url.searchParams.set("token", "123");
      const result = prepare("", url.href);
      expect(result.state).toBe("navigate");
      const editor = new URL(result.url);
      expect(editor.pathname).toBe("/cgi-bin/appmsg");
      expect(editor.searchParams.get("action")).toBe("edit");
      expect(editor.searchParams.get("token")).toBe("123");
      expect(editor.searchParams.get("isNew")).toBe("1");
    }
  });

  it("rejects unrelated domains and login pages without clicking anything", () => {
    expect(prepare("", "https://mp.weixin.qq.com.evil.example/?token=123").state).toBe("missing");
    expect(prepare("", "https://mp.weixin.qq.com/cgi-bin/bizlogin?token=123").state).toBe("login");
  });

  it("reuses an existing editor and never navigates away from its draft", () => {
    expect(
      prepare("", "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&appmsgid=42&token=123"),
    ).toMatchObject({ state: "editor" });
  });

  it("waits for navigation to finish before returning a fillable tab", async () => {
    vi.useFakeTimers();
    let url = "https://mp.weixin.qq.com/cgi-bin/home?token=123";
    let status = "complete";
    const editor = "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123";
    const update = vi.fn(async () => {
      status = "loading";
      setTimeout(() => {
        url = editor;
        status = "complete";
      }, 750);
    });
    const executeScript = vi
      .fn()
      .mockResolvedValue([
        { result: { state: "navigate", url: editor, message: "正在打开公众号文章编辑器" } },
      ]);
    vi.stubGlobal("browser", {
      tabs: { get: vi.fn(async () => ({ url, status })), update },
      scripting: { executeScript },
    });
    const pending = prepareWechatTab(7);
    await vi.runAllTimersAsync();
    expect((await pending).success).toBe(true);
    expect(update).toHaveBeenCalledWith(7, { url: editor });
    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it("returns a login requirement immediately", async () => {
    const update = vi.fn();
    vi.stubGlobal("browser", {
      tabs: {
        get: vi.fn().mockResolvedValue({ url: "https://mp.weixin.qq.com/", status: "complete" }),
        update,
      },
      scripting: {
        executeScript: vi
          .fn()
          .mockResolvedValue([{ result: { state: "login", message: "请重新扫码登录" } }]),
      },
    });
    expect(await prepareWechatTab(7)).toEqual({ success: false, message: "请重新扫码登录" });
    expect(update).not.toHaveBeenCalled();
  });
});
