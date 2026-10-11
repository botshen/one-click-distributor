import { isPlatformEditorUrl, isPlatformSiteUrl, type PlatformFillResult } from "./platforms";

// MAIN-world function: keep every runtime dependency inside the serialization boundary.
export function prepareWechatArticle(): {
  state: "editor" | "navigate" | "login" | "missing";
  message: string;
  url?: string;
} {
  if (location.protocol !== "https:" || location.hostname !== "mp.weixin.qq.com")
    return { state: "missing", message: "当前页面不是微信公众平台" };
  const visible = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  };
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>(
      '#login_container, .login_qrcode, .weui-desktop-login, [class*="login"]',
    ),
  ).filter(visible);
  if (
    location.pathname.includes("bizlogin") ||
    panels.some((element) =>
      /扫码登录|登录超时|请使用微信.*扫码/.test(element.innerText ?? element.textContent ?? ""),
    )
  )
    return { state: "login", message: "公众号后台登录已失效，请重新扫码登录" };
  const query = new URLSearchParams(location.search);
  if (
    location.pathname === "/cgi-bin/appmsg" &&
    query.get("action") === "edit" &&
    (query.get("createType") ?? query.get("createtype")) !== "8"
  )
    return { state: "editor", message: "正在等待公众号文章编辑器加载" };
  const token = query.get("token");
  if (token) {
    const target = new URL("/cgi-bin/appmsg", location.origin);
    target.search = `t=media/appmsg_edit&action=edit&type=10&isNew=1&token=${encodeURIComponent(token)}&lang=zh_CN`;
    return { state: "navigate", message: "正在打开公众号文章编辑器", url: target.href };
  }
  const textTarget = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="button"], li, div, span'))
      .filter((element) => visible(element) && element.textContent?.trim() === label)
      .map(
        (element) => element.closest<HTMLElement>('a, button, [role="button"], li') ?? element,
      )[0];
  for (const label of ["文章", "新的创作", "草稿箱", "全部草稿", "内容管理"]) {
    const target = textTarget(label);
    if (target) {
      target.click();
      return { state: "navigate", message: `正在打开公众号${label}` };
    }
  }
  return { state: "missing", message: "未找到公众号文章入口，请先确认已登录" };
}

export async function prepareWechatTab(
  tabId: number,
  onProgress?: (message: string) => void,
): Promise<PlatformFillResult> {
  const deadline = Date.now() + 20_000;
  let message = "正在等待公众号文章编辑器加载";
  let navigating = false;
  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId);
    if (!isPlatformSiteUrl("wechat", tab.url))
      return { success: false, message: "目标标签页已离开微信公众平台" };
    if (tab.status !== "loading") {
      if (isPlatformEditorUrl("wechat", tab.url)) return { success: true, message };
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: prepareWechatArticle,
        });
        const result = results[0]?.result;
        if (!result) return { success: false, message: "公众号页面未返回准备结果" };
        message = result.message;
        onProgress?.(message);
        if (result.state === "login" || result.state === "missing")
          return { success: false, message };
        if (result.url) {
          if (!isPlatformEditorUrl("wechat", result.url))
            return { success: false, message: "公众号返回了无效的文章地址" };
          await browser.tabs.update(tabId, { url: result.url });
        }
        navigating = result.state === "navigate";
      } catch (error) {
        // Navigation can destroy the execution context after an article shortcut is clicked.
        if (!navigating && !/frame|context|document|removed|closed/i.test(String(error)))
          throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { success: false, message: `${message}超时，请检查公众号页面后重试` };
}
