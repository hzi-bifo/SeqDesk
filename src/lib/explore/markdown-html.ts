import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify);

/**
 * Markdown to HTML for exported pages: GitHub flavour (tables, task lists,
 * strikethrough), raw HTML in the source dropped, like the in-app renderer.
 */
export function renderMarkdownHtml(markdown: string): string {
  return String(processor.processSync(markdown));
}
