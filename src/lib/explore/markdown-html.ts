import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const SAFE_URL = /^(https?:|mailto:|#|\/(?!\/)|\.{0,2}\/|[^:/?#]+$|[^:/?#]+[/?#])/i;

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Links and images keep only http(s), mailto and relative addresses; anything else loses its address. */
function safeUrls() {
  const visit = (node: HastNode) => {
    if (node.type === "element" && node.properties) {
      if (node.tagName === "a" && typeof node.properties.href === "string" && !SAFE_URL.test(node.properties.href.trim())) delete node.properties.href;
      if (node.tagName === "img" && typeof node.properties.src === "string" && !SAFE_URL.test(node.properties.src.trim())) delete node.properties.src;
    }
    for (const child of node.children ?? []) visit(child);
  };
  return (tree: HastNode) => visit(tree);
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(safeUrls).use(rehypeStringify);

/**
 * Markdown to HTML for exported pages: GitHub flavour (tables, task lists,
 * strikethrough), raw HTML in the source dropped, like the in-app renderer,
 * and no link may run script.
 */
export function renderMarkdownHtml(markdown: string): string {
  return String(processor.processSync(markdown));
}
