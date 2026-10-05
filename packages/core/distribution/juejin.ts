export const JUEJIN_EDITOR_URL = "https://juejin.cn/editor/drafts/new";

export type JuejinFillResult =
  | { success: true; message: string }
  | { success: false; message: string };

export function isJuejinEditorUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "juejin.cn" &&
      parsed.pathname.startsWith("/editor/")
    );
  } catch {
    return false;
  }
}

// This function is serialized into the page's MAIN world so it can use CodeMirror's page-owned instance.
export function fillJuejinEditor(input: { title: string; markdown: string }): JuejinFillResult {
  if (location.hostname !== "juejin.cn" || !location.pathname.startsWith("/editor/")) {
    return { success: false, message: "目标页面已离开掘金编辑器，未填入任何内容。" };
  }
  const title = document.querySelector<HTMLInputElement>(
    'input[placeholder*="请输入标题"], .title-input input, input[class*="title"]',
  );
  const editor = document.querySelector<HTMLElement>(
    ".bytemd-editor .CodeMirror, .bytemd .CodeMirror, .CodeMirror",
  );
  const codeMirror = (
    editor as
      | (HTMLElement & {
          CodeMirror?: {
            setValue(value: string): void;
            getValue(): string;
            focus(): void;
          };
        })
      | null
  )?.CodeMirror;
  const textarea = !editor
    ? Array.from(document.querySelectorAll<HTMLTextAreaElement>(".bytemd-editor textarea")).find(
        (element) => !element.closest(".CodeMirror"),
      )
    : null;

  if (!title || (!codeMirror && !textarea)) {
    return {
      success: false,
      message: "未找到掘金标题或 Markdown 编辑器。请确认已登录并进入文章编辑页，然后重试。",
    };
  }
  try {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return { success: false, message: "无法设置标题输入框" };
    setter.call(title, input.title);
    title.dispatchEvent(new Event("input", { bubbles: true }));
    title.dispatchEvent(new Event("change", { bubbles: true }));

    if (codeMirror) {
      codeMirror.setValue(input.markdown);
      codeMirror.focus();
    } else if (textarea) {
      const textareaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (!textareaSetter) return { success: false, message: "无法设置 Markdown 编辑框" };
      textareaSetter.call(textarea, input.markdown);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const actualMarkdown = codeMirror?.getValue() ?? textarea?.value;
    if (title.value !== input.title || actualMarkdown !== input.markdown) {
      return { success: false, message: "编辑器回读与稿件不一致，请到掘金页面检查后重试。" };
    }
    return {
      success: true,
      message: "标题和正文已填入并回读一致；请在掘金页面检查图片、格式和保存状态。",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "填入失败，请到掘金页面手动检查",
    };
  }
}

export async function fillJuejinTab(
  tabId: number,
  input: { title: string; markdown: string },
): Promise<JuejinFillResult> {
  const tab = await browser.tabs.get(tabId);
  if (!isJuejinEditorUrl(tab.url)) {
    return { success: false, message: "目标标签页不是掘金文章编辑器。请登录掘金并打开编辑页。" };
  }
  const results = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fillJuejinEditor,
    args: [input],
  });
  return results[0]?.result ?? { success: false, message: "掘金页面没有返回填入结果" };
}
