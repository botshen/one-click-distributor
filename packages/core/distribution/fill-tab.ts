import { fillJuejinTab } from "./juejin";
import {
  getDistributionPlatform,
  isPlatformEditorUrl,
  type PlatformFillResult,
  type PlatformId,
} from "./platforms";
import { prepareZhihuImages, renderDistributionHtml } from "./rich-text";
import { fillRichTextEditor } from "./rich-text-editor";
import { prepareWechatTab } from "./wechat-tab";

export async function fillPlatformTab(
  platform: PlatformId,
  tabId: number,
  input: { title: string; markdown: string },
  onProgress?: (message: string) => void,
): Promise<PlatformFillResult> {
  try {
    if (!input.title.trim() || !input.markdown.trim()) {
      return { success: false, message: "请先填写标题和正文" };
    }
    return await fillReadyPlatformTab(platform, tabId, input, onProgress);
  } catch (error) {
    return {
      success: false,
      message: `${getDistributionPlatform(platform).name}填稿失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function fillReadyPlatformTab(
  platform: PlatformId,
  tabId: number,
  input: { title: string; markdown: string },
  onProgress?: (message: string) => void,
): Promise<PlatformFillResult> {
  if (platform === "wechat") {
    const prepared = await prepareWechatTab(tabId, onProgress);
    if (!prepared.success) return prepared;
  }
  const tab = await browser.tabs.get(tabId);
  if (!isPlatformEditorUrl(platform, tab.url)) {
    return {
      success: false,
      message: `目标标签页不是${getDistributionPlatform(platform).name}文章编辑器。${getDistributionPlatform(platform).instructions}`,
    };
  }
  if (platform === "juejin") return fillJuejinTab(tabId, input);
  const html = renderDistributionHtml(input.markdown);
  const prepared = platform === "zhihu" ? await prepareZhihuImages(html, onProgress) : undefined;
  onProgress?.("正在处理图片并填入标题和正文…");
  const results = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fillRichTextEditor,
    args: [{ platform, title: input.title, html, ...prepared }],
  });
  return (
    results[0]?.result ?? {
      success: false,
      message: "目标页面没有返回填稿结果，请检查编辑器后重试。",
    }
  );
}
