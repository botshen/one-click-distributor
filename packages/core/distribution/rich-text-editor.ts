import type { PlatformFillResult, RichTextPlatformId } from "./platforms";

export interface RichTextEditorInput {
  platform: RichTextPlatformId;
  title: string;
  html: string;
  images?: Record<string, string>;
  warnings?: string[];
}

// Chrome serializes this function into MAIN. All runtime helpers must remain inside it.
// Ported from ziliu-extension-v2.0.42/plugins/platforms/{wechat,zhihu,zsxq}.js:
// MP JSAPI -> ProseMirror/UEditor; Draft.js HTML/image paste; Quill/list conversion.
export async function fillRichTextEditor(input: RichTextEditorInput): Promise<PlatformFillResult> {
  const { platform } = input;
  const names = { wechat: "微信公众号", zhihu: "知乎", zsxq: "知识星球" };
  const name = names[platform];
  const correctPage =
    platform === "wechat"
      ? location.hostname === "mp.weixin.qq.com" &&
        location.pathname === "/cgi-bin/appmsg" &&
        (new URLSearchParams(location.search).get("createType") ??
          new URLSearchParams(location.search).get("createtype")) !== "8"
      : platform === "zhihu"
        ? location.hostname === "zhuanlan.zhihu.com" &&
          (/^\/write\/?$/.test(location.pathname) || /^\/p\/\d+\/edit\/?$/.test(location.pathname))
        : location.hostname === "wx.zsxq.com" &&
          (location.pathname === "/article" ||
            location.pathname.startsWith("/group/") ||
            /^\/dweb\/?$/.test(location.pathname));
  if (!correctPage || location.protocol !== "https:") {
    return { success: false, message: `目标页面已离开${name}文章编辑器，未填入内容。` };
  }
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const normalize = (value: string) => value.replace(/[\s\u200b\ufeff]+/g, "");
  const warnings = [...(input.warnings ?? [])];
  function visible(element: HTMLElement) {
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }
  function find(selectors: string): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>(selectors)).find(visible) ?? null;
  }
  function findTitle() {
    return find(
      platform === "wechat"
        ? "#title"
        : platform === "zhihu"
          ? '.WriteIndex-titleInput input, .WriteIndex-titleInput textarea, textarea[placeholder*="标题"], input[placeholder*="标题"], .WriteIndex-titleInput[contenteditable="true"]'
          : 'input[placeholder*="请输入主题"], input[placeholder*="标题"], textarea[placeholder*="标题"], .topic-input input',
    );
  }
  function findEditor(): HTMLElement | null {
    if (platform === "zhihu")
      return find(
        '.public-DraftEditor-content[contenteditable="true"], .DraftEditor-editorContainer [contenteditable="true"], .notranslate[contenteditable="true"], .DraftEditor-root [role="textbox"]',
      );
    if (platform === "zsxq")
      return find(
        '.ql-editor[contenteditable="true"], .editor-content[contenteditable="true"], [contenteditable="true"]:not(.ql-editor-placeholder)',
      );
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('.ProseMirror[contenteditable="true"]'),
    ).filter(
      (element) => visible(element) && !element.classList.contains("editor_content_placeholder"),
    );
    const score = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width * rect.height +
        (element.closest("#ueditor_0") ? 2_000_000 : 0) +
        (element.closest(".mock-iframe-body") ? 1_000_000 : 0) +
        (element.closest(".rich_media_content") ? 500_000 : 0) -
        ((element.innerText ?? "").includes("从这里开始写正文") ? 200_000 : 0)
      );
    };
    candidates.sort((a, b) => score(b) - score(a));
    if (candidates[0]) return candidates[0];
    const legacy = document.querySelector<HTMLIFrameElement>("#ueditor_0 iframe");
    try {
      if (legacy?.contentDocument?.body) return legacy.contentDocument.body;
    } catch {
      /* Cross-origin iframe. */
    }
    return (
      Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]')).find(
        (element) => {
          if (
            !visible(element) ||
            element.matches(
              ".editor_content_placeholder, .original_primary_tips_input, .js_reprint_recommend_content",
            )
          )
            return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 300 && rect.height > 200;
        },
      ) ?? null
    );
  }
  async function waitUntil(check: () => boolean, timeout: number) {
    const start = Date.now();
    do {
      if (check()) return true;
      await delay(100);
    } while (Date.now() - start < timeout);
    return false;
  }
  function notify(element: HTMLElement) {
    for (const type of ["input", "change", "blur"])
      element.dispatchEvent(new Event(type, { bubbles: true }));
  }
  function setTitle(element: HTMLElement) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype =
        element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) throw new Error("无法设置标题输入框");
      setter.call(element, input.title);
    } else {
      element.textContent = input.title;
    }
    notify(element);
  }
  function titleValue(element: HTMLElement) {
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : (element.textContent ?? "");
  }
  function selectContents(element: HTMLElement, collapse = false) {
    element.focus();
    const doc = element.ownerDocument;
    const selection = doc.defaultView?.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(element);
    if (collapse) range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  async function clear(element: HTMLElement) {
    selectContents(element);
    element.ownerDocument.execCommand("delete", false);
    await delay(150);
    if (normalize(element.textContent ?? "") || element.querySelector("img")) {
      // Same last resort as the reference. The input event lets DOM-backed editors observe the mutation.
      element.innerHTML = "";
      notify(element);
      await delay(150);
    }
  }
  function paste(element: HTMLElement, html: string) {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", html);
    clipboardData.setData(
      "text/plain",
      new DOMParser().parseFromString(html, "text/html").body.textContent ?? "",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
  }

  try {
    if (!input.title.trim() || !input.html.trim()) throw new Error("请先填写标题和正文");
    const ready = await waitUntil(
      () => Boolean(findTitle() && findEditor()),
      platform === "zhihu" ? 10_000 : 5_000,
    );
    if (!ready)
      return {
        success: false,
        message: `未找到${name}标题和正文编辑器。请先登录并打开文章编辑页，再返回工作台重试。`,
      };
    const title = findTitle();
    const initialEditor = findEditor();
    if (!title || !initialEditor) throw new Error("编辑器正在切换，请重试");
    let editor: HTMLElement = initialEditor;
    const content = new DOMParser().parseFromString(input.html, "text/html").body;

    if (platform === "zsxq") {
      // zsxq strips standard list markup. Preserve the reference's numbered/bullet paragraphs,
      // using the DOM so nested lists and ol[start] are not broken by regex replacement.
      for (const list of Array.from(content.querySelectorAll("ol, ul")).reverse()) {
        const ordered = list.tagName === "OL";
        let counter = Number(list.getAttribute("start")) || 1;
        const replacement = document.createElement("div");
        for (const item of Array.from(list.children)) {
          if (item.tagName !== "LI") continue;
          const paragraph = document.createElement("p");
          paragraph.style.margin = "16px 0";
          paragraph.append(document.createTextNode(ordered ? `${counter++}. ` : "• "));
          paragraph.append(...Array.from(item.childNodes));
          replacement.append(paragraph);
        }
        list.replaceWith(replacement);
      }
    }

    if (platform === "wechat") {
      const token = new URLSearchParams(location.search).get("token");
      const fingerprint =
        Array.from(document.scripts)
          .map((script) => script.textContent ?? "")
          .join("\n")
          .match(/fingerprint['"\s]*:\s*['"\s]([^'"]+)['"\s]/)?.[1] ??
        Math.random().toString(36).slice(2);
      const uploaded = new Map<string, string>();
      for (const [index, image] of Array.from(content.querySelectorAll("img")).entries()) {
        const src = image.getAttribute("src") ?? "";
        if (!/^https?:\/\//i.test(src) || new URL(src).hostname === "mmbiz.qpic.cn") continue;
        try {
          if (!token) throw new Error("公众号编辑页缺少登录 token");
          if (!uploaded.has(src)) {
            let url = "";
            for (let attempt = 0; attempt <= 3; attempt++) {
              try {
                const body = new URLSearchParams({
                  t: "ajax-editor-upload-img",
                  imgUrl: src,
                  fingerprint,
                  token,
                  lang: "zh_CN",
                  f: "json",
                  ajax: "1",
                });
                const response = await fetch(
                  `/cgi-bin/uploadimg2cdn?lang=zh_CN&token=${encodeURIComponent(token)}&t=${Math.random()}`,
                  {
                    method: "POST",
                    credentials: "include",
                    body,
                    signal: AbortSignal.timeout(30_000),
                    headers: {
                      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                      "X-Requested-With": "XMLHttpRequest",
                    },
                  },
                );
                if (!response.ok)
                  throw Object.assign(new Error(`HTTP ${response.status}`), {
                    status: response.status,
                  });
                const result = await response.json();
                if (result.errcode !== 0 || !result.url)
                  throw Object.assign(new Error(result.errmsg || "图床返回异常"), {
                    code: result.errcode,
                  });
                const hosted = new URL(result.url);
                if (!/^https?:$/.test(hosted.protocol) || hosted.hostname !== "mmbiz.qpic.cn")
                  throw new Error("图床返回的地址无效");
                url = hosted.href;
                break;
              } catch (error) {
                const failure = error as { status?: number; code?: number; message?: string };
                const fatal =
                  [401, 403, 404].includes(failure.status ?? failure.code ?? 0) ||
                  /token无效|权限不足|账号异常|接口不存在/.test(failure.message ?? "");
                if (attempt === 3 || fatal) throw error;
                await delay(
                  Math.round(Math.min(1000 * 2 ** attempt + Math.random() * 1000, 10_000)),
                );
              }
            }
            uploaded.set(src, url);
            await delay(500);
          }
          image.setAttribute("src", uploaded.get(src) ?? src);
        } catch (error) {
          warnings.push(
            `图片 ${index + 1} 转存失败，保留原链接：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    if (platform === "zhihu") {
      const uploaded = new Map<string, string>();
      const hosted = (src: string) => {
        try {
          return /(^|\.)(zhimg\.com|pic\.zhihu\.com|pic-private\.zhihu\.com)$/.test(
            new URL(src).hostname,
          );
        } catch {
          return false;
        }
      };
      for (const [index, image] of Array.from(content.querySelectorAll("img")).entries()) {
        const src = image.getAttribute("src") ?? "";
        if (hosted(src)) continue;
        if (uploaded.has(src)) {
          image.setAttribute("src", uploaded.get(src) ?? src);
          continue;
        }
        const data = input.images?.[src];
        if (!data) continue; // Download failures were already reported by prepareZhihuImages.
        try {
          editor = findEditor() ?? editor;
          const before = new Set(Array.from(editor.querySelectorAll("img"), (img) => img.src));
          selectContents(editor, true);
          const match = data.match(/^data:(image\/[^;,]+);base64,([\s\S]+)$/);
          if (!match) throw new Error("图片数据无效");
          const binary = atob(match[2]);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          const clipboardData = new DataTransfer();
          const extension = match[1]
            .slice("image/".length)
            .replace("jpeg", "jpg")
            .replace("svg+xml", "svg");
          clipboardData.items.add(
            new File([bytes], `image-${index}.${extension}`, { type: match[1] }),
          );
          editor.dispatchEvent(
            new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
          );
          let url = "";
          const success = await waitUntil(() => {
            editor = findEditor() ?? editor;
            url =
              Array.from(editor.querySelectorAll("img"), (img) => img.src).find(
                (value) => hosted(value) && !before.has(value),
              ) ?? "";
            return Boolean(url);
          }, 20_000);
          if (!success) throw new Error("编辑器上传超时");
          uploaded.set(src, url);
          image.setAttribute("src", url);
          await delay(1500);
        } catch (error) {
          warnings.push(
            `图片 ${index + 1} 上传失败，保留原链接：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const html = content.innerHTML;
    const expectedText = normalize(content.textContent ?? "");
    const expectedImages = content.querySelectorAll("img").length;
    const matches = () => {
      editor = findEditor() ?? editor;
      return (
        normalize(editor.textContent ?? "") === expectedText &&
        editor.querySelectorAll("img").length === expectedImages
      );
    };
    setTitle(title);
    editor = findEditor() ?? editor;
    let filled = false;
    if (platform === "wechat") {
      const page = window as unknown as {
        MP_Editor_JSAPI?: { invoke(params: unknown): void };
        __MP_Editor_JSAPI__?: { invoke(params: unknown): void };
        UE?: { getEditor(id: string): { setContent(html: string): void } };
      };
      const api = page.MP_Editor_JSAPI ?? page.__MP_Editor_JSAPI__;
      if (api?.invoke) {
        await clear(editor);
        for (const [apiName, apiParam] of [
          ["mp_editor_insert_html", { html, isSelect: false }],
          ["mp_editor_set_content", { content: html }],
        ] as const) {
          try {
            api.invoke({ apiName, apiParam, sucCb: () => {}, errCb: () => {} });
            filled = await waitUntil(matches, 1500);
            if (filled) break;
          } catch {
            /* Try next API, then the editor-specific fallback. */
          }
        }
      }
      if (!filled && editor.ownerDocument !== document && page.UE?.getEditor) {
        try {
          page.UE.getEditor("ueditor_0").setContent(html);
          filled = await waitUntil(matches, 1500);
        } catch {
          /* The reference also falls back to the iframe body when the UEditor API fails. */
        }
      }
    }
    if (platform === "zsxq" && editor.classList.contains("ql-editor")) {
      type QuillEditor = {
        clipboard: { dangerouslyPasteHTML(html: string, source: string): void };
        update?(source: string): void;
      };
      const page = window as unknown as {
        Quill?: { find(element: HTMLElement): QuillEditor | undefined };
      };
      const quill =
        (editor as HTMLElement & { __quill?: QuillEditor }).__quill ??
        (editor.parentElement as (HTMLElement & { __quill?: QuillEditor }) | null)?.__quill ??
        page.Quill?.find(editor.parentElement ?? editor);
      if (quill?.clipboard) {
        quill.clipboard.dangerouslyPasteHTML(html, "user");
        quill.update?.("user");
        filled = await waitUntil(matches, 1000);
      }
    }
    if (!filled) {
      await clear(editor);
      selectContents(editor);
      paste(editor, html);
      filled = await waitUntil(matches, platform === "zhihu" ? 3000 : 500);
      if (!filled) {
        selectContents(editor);
        editor.ownerDocument.execCommand("insertHTML", false, html);
        filled = await waitUntil(matches, 1000);
      }
      if (!filled && platform !== "zhihu") {
        editor.innerHTML = html;
        notify(editor);
        if (platform === "zsxq")
          editor.dispatchEvent(
            new CustomEvent("text-change", {
              bubbles: true,
              detail: { delta: null, oldDelta: null, source: "user" },
            }),
          );
        filled = await waitUntil(matches, 1000);
      }
    }
    notify(editor);
    await delay(500); // Allow React/ProseMirror/Quill to reconcile before reading back.
    if (!filled || !matches() || titleValue(findTitle() ?? title) !== input.title) {
      return {
        success: false,
        message: `${name}编辑器回读与稿件不一致，请到目标页面检查后重试。`,
        warnings,
      };
    }
    return {
      success: true,
      message: `标题和正文已填入${name}并回读一致；请在平台检查格式、图片和保存状态。${warnings.length ? `有 ${warnings.length} 张图片未完成转存。` : ""}`,
      warnings,
    };
  } catch (error) {
    return {
      success: false,
      message: `${name}填稿失败：${error instanceof Error ? error.message : String(error)}`,
      warnings,
    };
  }
}
