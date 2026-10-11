import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDistributionHtml } from "./rich-text";
import { fillRichTextEditor, type RichTextEditorInput } from "./rich-text-editor";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function page(markup: string, url: string) {
  const window = parseHTML(`<html><head></head><body>${markup}</body></html>`);
  // linkedom's window proxies arbitrary properties to the Node global object.
  // Each fixture must start without native APIs installed by previous tests.
  Object.assign(window, {
    MP_Editor_JSAPI: undefined,
    __MP_Editor_JSAPI__: undefined,
    UE: undefined,
    Quill: undefined,
  });
  const document = window.document;
  let selected: HTMLElement | undefined;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{}],
  });
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: 600, height: 400 }),
  });
  Object.defineProperty(document, "scripts", { value: document.querySelectorAll("script") });
  Object.assign(document, {
    createRange: () => ({
      selectNodeContents: (element: HTMLElement) => {
        selected = element;
      },
      collapse() {},
    }),
    execCommand: (command: string, _ui: boolean, value: string) => {
      if (!selected) return false;
      selected.innerHTML = command === "delete" ? "" : value;
      return true;
    },
  });
  class Transfer {
    data = new Map<string, string>();
    files: File[] = [];
    items = {
      add: (file: File) => {
        this.files.push(file);
      },
    };
    setData(type: string, value: string) {
      this.data.set(type, value);
    }
    getData(type: string) {
      return this.data.get(type) ?? "";
    }
  }
  class PasteEvent extends window.Event {
    clipboardData: Transfer;
    constructor(type: string, options: { clipboardData: Transfer }) {
      super(type, { bubbles: true, cancelable: true });
      this.clipboardData = options.clipboardData;
    }
  }
  const selection = { removeAllRanges() {}, addRange() {} };
  Object.assign(window, { getSelection: () => selection });
  return {
    window,
    document,
    context: {
      window,
      document,
      input: {} as RichTextEditorInput,
      location: new URL(url),
      HTMLInputElement: window.HTMLInputElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      DOMParser: class {
        parseFromString(html: string) {
          // linkedom does not synthesize html/body for fragments as Chrome's DOMParser does.
          return parseHTML(`<html><head></head><body>${html}</body></html>`).document;
        }
      },
      Event: window.Event,
      CustomEvent: window.CustomEvent,
      DataTransfer: Transfer,
      ClipboardEvent: PasteEvent,
      URL,
      URLSearchParams,
      Date,
      setTimeout,
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      fetch: vi.fn(),
      AbortSignal,
      File,
      Uint8Array,
      atob,
    },
  };
}

async function fill(fixture: ReturnType<typeof page>, input: RichTextEditorInput) {
  fixture.context.input = input;
  // Same serialization boundary as chrome.scripting, with no module-level helpers available.
  const pending = runInNewContext(`(${fillRichTextEditor.toString()})(input)`, fixture.context);
  await vi.runAllTimersAsync();
  return await pending;
}

describe("serialized platform editor adapters", () => {
  it("renders Markdown without executing imported source HTML", () => {
    const html = renderDistributionHtml(
      "# 正文\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))",
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
  });

  it("uses WeChat JSAPI and the primary body, leaving the small auxiliary editor alone", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true">辅助区域</div><div id="ueditor_0"><div class="ProseMirror" contenteditable="true">旧正文</div></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const main = fixture.document.querySelector("#ueditor_0 .ProseMirror");
    const invoke = vi.fn((params: { apiName: string; apiParam: { html: string } }) => {
      if (main) main.innerHTML = params.apiParam.html;
    });
    Object.assign(fixture.window, { MP_Editor_JSAPI: { invoke } });
    const result = await fill(fixture, {
      platform: "wechat",
      title: "公众号测试",
      html: "<p>新的正文</p>",
    });
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ apiName: "mp_editor_insert_html" }),
    );
    expect(fixture.document.querySelector(".ProseMirror")?.textContent).toBe("辅助区域");
    expect(fixture.document.querySelector<HTMLInputElement>("#title")?.value).toBe("公众号测试");
    expect(main?.textContent).toBe("新的正文");
  });

  it("does not dispatch a second input event after native WeChat insertion", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true"></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const main = fixture.document.querySelector(".ProseMirror");
    const duplicate = "重复正文";
    main?.addEventListener("input", () => {
      if (main?.textContent === duplicate) main.innerHTML += `<p>${duplicate}</p>`;
    });
    const invoke = vi.fn((params: { apiParam: { html?: string; content?: string } }) => {
      if (main) main.innerHTML = params.apiParam.html ?? params.apiParam.content ?? "";
    });
    Object.assign(fixture.window, { MP_Editor_JSAPI: { invoke } });
    const result = await fill(fixture, {
      platform: "wechat",
      title: "重复测试",
      html: `<p>${duplicate}</p>`,
    });
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(main?.textContent).toBe(duplicate);
  });

  it("waits for asynchronous WeChat JSAPI insertion without invoking a second writer", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true"></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const main = fixture.document.querySelector(".ProseMirror");
    const invoke = vi.fn((params: { apiParam: { html: string }; sucCb(): void }) => {
      setTimeout(() => {
        if (main) main.innerHTML += params.apiParam.html;
        params.sucCb();
      }, 3000);
    });
    const setContent = vi.fn();
    Object.assign(fixture.window, {
      MP_Editor_JSAPI: { invoke },
      UE: { getEditor: () => ({ setContent }) },
    });
    const result = await fill(fixture, {
      platform: "wechat",
      title: "延迟测试",
      html: "<p>单次正文</p>",
    });
    expect(result.success).toBe(true);
    expect(main?.textContent).toBe("单次正文");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(setContent).not.toHaveBeenCalled();
  });

  it("does not issue another write when native WeChat insertion times out", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true"></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const main = fixture.document.querySelector(".ProseMirror");
    const invoke = vi.fn((params: { apiParam: { html: string } }) => {
      setTimeout(() => {
        if (main) main.innerHTML += params.apiParam.html;
      }, 12_000);
    });
    Object.assign(fixture.window, { MP_Editor_JSAPI: { invoke } });
    const result = await fill(fixture, {
      platform: "wechat",
      title: "超时测试",
      html: "<p>迟到正文</p>",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("避免重复填稿");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(main?.textContent).toBe("迟到正文");
  });

  it("does not fall back to another API when native WeChat readback differs", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true"></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const main = fixture.document.querySelector(".ProseMirror");
    const invoke = vi.fn((params: { apiParam: { html: string } }) => {
      if (main) main.innerHTML += `${params.apiParam.html}<span>处理中</span>`;
    });
    const setContent = vi.fn();
    Object.assign(fixture.window, {
      MP_Editor_JSAPI: { invoke },
      UE: { getEditor: () => ({ setContent }) },
    });
    const result = await fill(fixture, {
      platform: "wechat",
      title: "差异测试",
      html: "<p>单次正文</p>",
    });
    expect(result.success).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(setContent).not.toHaveBeenCalled();
    expect(main?.textContent).toBe("单次正文处理中");
  });

  it("waits for a delayed WeChat paste instead of also inserting HTML", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true"></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const main = fixture.document.querySelector(".ProseMirror");
    main?.addEventListener("paste", (event) => {
      event.preventDefault();
      const html = (
        event as unknown as { clipboardData: { getData(type: string): string } }
      ).clipboardData.getData("text/html");
      setTimeout(() => {
        if (main) main.innerHTML += html;
      }, 1200);
    });
    const commands = vi.spyOn(fixture.document, "execCommand");
    const result = await fill(fixture, {
      platform: "wechat",
      title: "粘贴测试",
      html: "<p>单次正文</p>",
    });
    expect(result.success).toBe(true);
    expect(main?.textContent).toBe("单次正文");
    expect(commands.mock.calls.some(([command]) => command === "insertHTML")).toBe(false);
  });

  it("replaces duplicated existing WeChat text on repeated fills", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true"><p>正文</p><p>正文</p></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const main = fixture.document.querySelector(".ProseMirror");
    const input: RichTextEditorInput = {
      platform: "wechat",
      title: "重复填入",
      html: "<p>正文</p>",
    };
    expect((await fill(fixture, input)).success).toBe(true);
    expect((await fill(fixture, input)).success).toBe(true);
    expect(main?.textContent).toBe("正文");
    expect(main?.querySelectorAll("p")).toHaveLength(1);
  });

  it("finds the current WeChat contenteditable title without relying on #title", async () => {
    const fixture = page(
      '<div class="title-input" contenteditable="true">请在这里输入标题</div><div class="editor-shell"><div contenteditable="true">旧正文</div></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const editor = fixture.document.querySelector(".editor-shell [contenteditable]");
    const result = await fill(fixture, {
      platform: "wechat",
      title: "动态标题",
      html: "<p>新的正文</p>",
    });
    expect(result.success).toBe(true);
    expect(fixture.document.querySelector(".title-input")?.textContent).toBe("动态标题");
    expect(editor?.textContent).toBe("新的正文");
  });

  it("keeps a title identified only by its placeholder text after filling it", async () => {
    const fixture = page(
      '<div contenteditable="true">请在这里输入标题</div><div class="ProseMirror" contenteditable="true">旧正文</div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const result = await fill(fixture, {
      platform: "wechat",
      title: "测试标题",
      html: "<p>作者介绍摘要封面</p>",
    });
    expect(result.success).toBe(true);
    expect(fixture.document.querySelector("[contenteditable]")?.textContent).toBe("测试标题");
    expect(fixture.document.querySelector(".ProseMirror")?.textContent).toBe("作者介绍摘要封面");
  });

  it("accepts WeChat title readback with editor-only zero-width markers and line breaks", async () => {
    const fixture = page(
      '<div class="title-input" contenteditable="true">请在这里输入标题</div><div class="ProseMirror" contenteditable="true"></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const title = fixture.document.querySelector(".title-input");
    title?.addEventListener("input", () => {
      if (title) title.textContent = `${title.textContent}\u200b\n`;
    });
    const result = await fill(fixture, {
      platform: "wechat",
      title: "视觉一致标题",
      html: "<p>正文</p>",
    });
    expect(result.success).toBe(true);
  });

  it("still rejects a genuinely different WeChat title", async () => {
    const fixture = page(
      '<div class="title-input" contenteditable="true">请在这里输入标题</div><div class="ProseMirror" contenteditable="true"></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const title = fixture.document.querySelector(".title-input");
    title?.addEventListener("input", () => {
      if (title) title.textContent = "另一个标题";
    });
    const result = await fill(fixture, {
      platform: "wechat",
      title: "视觉一致标题",
      html: "<p>正文</p>",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("回读与稿件不一致");
  });

  it("removes external anchors while preserving labels, formatting and WeChat links", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true"></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const result = await fill(fixture, {
      platform: "wechat",
      title: "链接测试",
      html: '<p><a href="https://example.com"><strong>外部内容</strong></a><a href="https://mp.weixin.qq.com/s/example">微信文章</a></p>',
    });
    expect(result.success).toBe(true);
    const editor = fixture.document.querySelector(".ProseMirror");
    expect(editor?.querySelectorAll("a")).toHaveLength(1);
    expect(editor?.querySelector("strong")?.textContent).toBe("外部内容");
    expect(editor?.querySelector("section")).not.toBeNull();
  });

  it("does not report success when WeChat shows an insertion failure", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true"></div><div role="alert">有 1 个内容插入失败 · 查看失败内容</div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    const result = await fill(fixture, {
      platform: "wechat",
      title: "失败测试",
      html: "<p>正文</p>",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("插入失败");
  });

  it("replaces existing Zhihu content through an HTML paste", async () => {
    const fixture = page(
      '<textarea placeholder="请输入标题"></textarea><div class="DraftEditor-editorContainer"><div contenteditable="true">旧稿</div></div>',
      "https://zhuanlan.zhihu.com/p/123/edit",
    );
    const editor = fixture.document.querySelector('[contenteditable="true"]');
    editor?.addEventListener("paste", (event) => {
      if (editor)
        editor.innerHTML = (
          event as unknown as { clipboardData: { getData(type: string): string } }
        ).clipboardData.getData("text/html");
    });
    expect(
      (
        await fill(fixture, {
          platform: "zhihu",
          title: "知乎测试",
          html: "<h2>小标题</h2><p><strong>正文</strong></p>",
        })
      ).success,
    ).toBe(true);
    expect(editor?.querySelector("strong")?.textContent).toBe("正文");
    expect(editor?.textContent).not.toContain("旧稿");
  });

  it("fills the legacy WeChat iframe even when its UEditor API fails", async () => {
    const fixture = page(
      '<input id="title"><div id="ueditor_0"><iframe></iframe></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit",
    );
    const legacy = parseHTML('<html><body contenteditable="true">旧正文</body></html>').document;
    Object.assign(legacy, {
      createRange: fixture.document.createRange,
      execCommand: fixture.document.execCommand,
    });
    Object.defineProperty(fixture.document.querySelector("iframe"), "contentDocument", {
      value: legacy,
    });
    Object.assign(fixture.window, {
      UE: {
        getEditor: () => {
          throw new Error("API unavailable");
        },
      },
    });
    const result = await fill(fixture, {
      platform: "wechat",
      title: "旧编辑器稿件",
      html: "<p>新的正文</p>",
    });
    expect(result.success).toBe(true);
    expect(legacy.body.textContent).toBe("新的正文");
  });

  it("uses Quill and converts nested lists to visible numbered/bullet paragraphs", async () => {
    const fixture = page(
      '<input placeholder="请输入主题"><div class="ql-container"><div class="ql-editor" contenteditable="true">旧稿</div></div>',
      "https://wx.zsxq.com/article?groupId=123",
    );
    const editor = fixture.document.querySelector(".ql-editor") as HTMLElement & {
      __quill?: unknown;
    };
    const pasteHtml = vi.fn((html: string) => {
      editor.innerHTML = html;
    });
    editor.__quill = { clipboard: { dangerouslyPasteHTML: pasteHtml }, update: vi.fn() };
    expect(
      (
        await fill(fixture, {
          platform: "zsxq",
          title: "星球测试",
          html: '<ol start="3"><li>外层<ul><li>嵌套</li></ul></li><li>后续</li></ol>',
        })
      ).success,
    ).toBe(true);
    expect(pasteHtml).toHaveBeenCalledWith(expect.any(String), "user");
    expect(editor.textContent).toContain("3. 外层• 嵌套4. 后续");
    expect(editor.querySelector("ol,ul,li")).toBeNull();
  });

  it("uploads an external Zhihu image with a file name, then replaces the temporary upload with the full draft", async () => {
    const fixture = page(
      '<input placeholder="请输入标题"><div class="DraftEditor-editorContainer"><div contenteditable="true">旧稿</div></div>',
      "https://zhuanlan.zhihu.com/write",
    );
    const editor = fixture.document.querySelector('[contenteditable="true"]');
    const hosted = "https://pic1.zhimg.com/uploaded.png";
    const names: string[] = [];
    editor?.addEventListener("paste", (event) => {
      const data = (
        event as unknown as { clipboardData: { files: File[]; getData(type: string): string } }
      ).clipboardData;
      if (!editor) return;
      if (data.files.length) {
        names.push(data.files[0].name);
        editor.innerHTML += `<img src="${hosted}">`;
      } else editor.innerHTML = data.getData("text/html");
    });
    const result = await fill(fixture, {
      platform: "zhihu",
      title: "带图稿件",
      html: '<p>完整正文<img src="https://images.example/a.png"></p>',
      images: { "https://images.example/a.png": "data:image/png;base64,aGVsbG8=" },
    });
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(names).toEqual(["image-0.png"]);
    expect(editor?.querySelectorAll("img")).toHaveLength(1);
    expect(editor?.querySelector("img")?.getAttribute("src")).toBe(hosted);
    expect(editor?.textContent).toBe("完整正文");
  });

  it("does not change a title on an unrelated page or when the body is missing", async () => {
    const fixture = page(
      '<input id="title" value="原题">',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit",
    );
    expect(
      (await fill(fixture, { platform: "wechat", title: "新题", html: "<p>新稿</p>" })).success,
    ).toBe(false);
    expect(fixture.document.querySelector<HTMLInputElement>("#title")?.value).toBe("原题");
    fixture.context.location = new URL("https://mp.weixin.qq.com.evil.example/cgi-bin/appmsg");
    expect(
      (await fill(fixture, { platform: "wechat", title: "新题", html: "<p>新稿</p>" })).success,
    ).toBe(false);
  });

  it("reports image upload failures while filling text and retaining the image URL", async () => {
    const fixture = page(
      '<input id="title"><div class="ProseMirror" contenteditable="true"></div>',
      "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&token=123",
    );
    fixture.context.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ errcode: -1, errmsg: "上传失败" }),
    });
    const result = await fill(fixture, {
      platform: "wechat",
      title: "图片测试",
      html: '<p>正文<img src="https://images.example/a.png"></p>',
    });
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(fixture.context.fetch).toHaveBeenCalledTimes(4);
    expect(fixture.document.querySelector("img")?.getAttribute("src")).toBe(
      "https://images.example/a.png",
    );
  });
});
