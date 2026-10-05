import { describe, expect, it } from "vitest";
import { hasRelativeMarkdownImages, parseImportedMarkdown } from "./markdown";

describe("distribution markdown import", () => {
  it("uses frontmatter title and removes metadata from the editable body", () => {
    expect(
      parseImportedMarkdown(
        '---\ntitle: "平台稿"\nsource: x\n---\n\n# 正文标题\n\n内容',
        "file.md",
      ),
    ).toEqual({ title: "平台稿", markdown: "# 正文标题\n\n内容" });
  });

  it("falls back to the first heading or file name", () => {
    expect(parseImportedMarkdown("# 标题\n正文", "file.md").title).toBe("标题");
    expect(parseImportedMarkdown("正文", "file.markdown").title).toBe("file");
  });

  it("normalizes Windows line endings before removing frontmatter", () => {
    expect(parseImportedMarkdown("---\r\ntitle: Windows\r\n---\r\n\r\n# Body\r\n", "a.md")).toEqual(
      { title: "Windows", markdown: "# Body" },
    );
  });

  it("warns about local images but not public image URLs", () => {
    expect(hasRelativeMarkdownImages("![图](./assets/a.png)")).toBe(true);
    expect(hasRelativeMarkdownImages("![图](https://cdn.example.com/a.png)")).toBe(false);
  });
});
