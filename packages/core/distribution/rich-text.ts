import MarkdownIt from "markdown-it";
import type { RichTextPlatformId } from "./platforms";

// Final JS library adapter, shared with all rich-text destinations. Raw source HTML stays disabled.
const renderer = new MarkdownIt({ html: false, breaks: true, linkify: true });

export function renderDistributionHtml(markdown: string): string {
  return renderer.render(markdown);
}

export function isHostedPlatformImage(platform: RichTextPlatformId, src: string): boolean {
  try {
    const url = new URL(src);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return platform === "wechat"
      ? url.hostname === "mmbiz.qpic.cn"
      : platform === "zhihu" &&
          /(^|\.)(zhimg\.com|pic\.zhihu\.com|pic-private\.zhihu\.com)$/.test(url.hostname);
  } catch {
    return false;
  }
}

export async function prepareZhihuImages(html: string, onProgress?: (message: string) => void) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sources = [
    ...new Set(Array.from(doc.querySelectorAll("img"), (image) => image.getAttribute("src") || "")),
  ].filter((src) => src && !isHostedPlatformImage("zhihu", src));
  const images: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [index, src] of sources.entries()) {
    onProgress?.(`正在准备知乎图片 ${index + 1}/${sources.length}…`);
    try {
      if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src))
        throw new Error("图片地址不可访问");
      const response = await fetch(src, {
        credentials: "include",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("资源不是图片");
      if (blob.size > 12 * 1024 * 1024) throw new Error("图片超过 12 MB");
      images[src] = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      warnings.push(
        `图片 ${index + 1} 下载失败，保留原链接：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { images, warnings };
}
