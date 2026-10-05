const FRONTMATTER_PATTERN = /^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/;

export function stripMarkdownFrontmatter(markdown: string): string {
  return markdown.replace(/^\uFEFF/, "").replace(FRONTMATTER_PATTERN, "");
}

export function parseImportedMarkdown(
  content: string,
  fileName: string,
): { title: string; markdown: string } {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const markdown = stripMarkdownFrontmatter(normalized).trim();
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const frontmatter = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)?.[1];
  const frontmatterTitle = frontmatter
    ?.match(/^title:\s*(.+?)\s*$/m)?.[1]
    ?.replace(/^['"]|['"]$/g, "")
    .trim();
  return {
    title: frontmatterTitle || heading || fileName.replace(/\.(md|markdown)$/i, "") || "未命名稿件",
    markdown,
  };
}

export function hasRelativeMarkdownImages(markdown: string): boolean {
  return /!\[[^\]]*\]\((?!https?:\/\/|data:|blob:|\/\/)[^)]+\)/i.test(markdown);
}
