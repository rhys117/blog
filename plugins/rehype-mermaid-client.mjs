import { visit } from "unist-util-visit";

/**
 * A rehype plugin that converts Shiki-highlighted mermaid code blocks
 * into <pre class="mermaid"> elements for client-side rendering.
 */
export default function rehypeMermaidClient() {
  return (tree) => {
    visit(tree, "element", (node, index, parent) => {
      if (
        node.tagName === "pre" &&
        node.properties?.dataLanguage === "mermaid"
      ) {
        // Extract the raw text from the code block
        const code = node.children?.[0];
        if (code?.tagName === "code") {
          const text = extractText(code);
          // Replace with a simple <pre class="mermaid"> for Mermaid.js
          node.properties = { className: ["mermaid"] };
          node.children = [{ type: "text", value: text }];
        }
      }
    });
  };
}

function extractText(node) {
  if (node.type === "text") return node.value;
  if (node.children) return node.children.map(extractText).join("");
  return "";
}
