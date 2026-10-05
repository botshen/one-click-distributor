import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fillJuejinEditor, isJuejinEditorUrl } from "./juejin";

afterEach(() => vi.unstubAllGlobals());

describe("Juejin draft filling", () => {
  it("only accepts the Juejin editor URL", () => {
    expect(isJuejinEditorUrl("https://juejin.cn/editor/drafts/new")).toBe(true);
    expect(isJuejinEditorUrl("https://evil.example/editor/drafts/new")).toBe(false);
    expect(isJuejinEditorUrl("https://juejin.cn.evil.example/editor/drafts/new")).toBe(false);
  });

  it("fills title and CodeMirror content, then reads both values back", () => {
    const window = parseHTML(
      '<input placeholder="请输入标题"><div class="bytemd-editor"><div class="CodeMirror"></div></div>',
    );
    const wrapper = window.document.querySelector(".CodeMirror") as HTMLElement & {
      CodeMirror: unknown;
    };
    let value = "";
    wrapper.CodeMirror = {
      setValue(next: string) {
        value = next;
      },
      getValue() {
        return value;
      },
      focus() {},
    };
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("location", { hostname: "juejin.cn", pathname: "/editor/drafts/new" });
    vi.stubGlobal("HTMLInputElement", window.HTMLInputElement);
    vi.stubGlobal("Event", window.Event);
    expect(fillJuejinEditor({ title: "测试稿", markdown: "# 正文\n\n内容" })).toMatchObject({
      success: true,
    });
    expect(window.document.querySelector("input")?.value).toBe("测试稿");
    expect(value).toBe("# 正文\n\n内容");
  });

  it("fails safely when the editor is missing", () => {
    const window = parseHTML("<main>请登录</main>");
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("location", { hostname: "juejin.cn", pathname: "/editor/drafts/new" });
    expect(fillJuejinEditor({ title: "标题", markdown: "正文" }).success).toBe(false);
  });
});
