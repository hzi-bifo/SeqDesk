import { describe, expect, it } from "vitest";
import { renderMarkdownHtml } from "./markdown-html";

describe("Markdown for the shared page", () => {
  it("keeps ordinary links and drops addresses that could run script", () => {
    expect(renderMarkdownHtml("[a](https://example.org/x) [b](mailto:x@y.z) [c](#top) [d](/explore) [e](figures/1.png)")).toContain('href="https://example.org/x"');
    const html = renderMarkdownHtml("[a](https://example.org/x) [b](mailto:x@y.z) [c](#top) [d](/explore) [e](figures/1.png)");
    for (const href of ["mailto:x@y.z", "#top", "/explore", "figures/1.png"]) expect(html).toContain(`href="${href}"`);
    const bad = renderMarkdownHtml("[x](javascript:alert(1)) [y](JAVASCRIPT:alert(2)) [z](data:text/html,hi) ![i](javascript:alert(3))");
    expect(bad).not.toMatch(/javascript:/i);
    expect(bad).not.toContain("data:text/html");
    expect(bad).toContain("<a>x</a>");
  });

  it("drops raw HTML and keeps tables", () => {
    const html = renderMarkdownHtml("<script>alert(1)</script>\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<table>");
  });
});
