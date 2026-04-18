/** 从 Mind Elixir 节点 topic 中去掉简单 HTML，便于匹配纯文本 */
export function stripMindTopicHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export type MindMapSearchHit = { id: string; preview: string };

/**
 * 前序遍历 nodeData 树，收集 topic 文本包含 query 的节点（不区分大小写）。
 */
export function searchMindMapNodesPreorder(root: unknown, query: string): MindMapSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: MindMapSearchHit[] = [];

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as { id?: string; topic?: unknown; children?: unknown[] };
    if (typeof n.id === "string") {
      const raw = typeof n.topic === "string" ? n.topic : String(n.topic ?? "");
      const plain = stripMindTopicHtml(raw);
      if (plain.toLowerCase().includes(q)) {
        const preview = plain.replace(/\s+/g, " ").trim().slice(0, 80) || n.id;
        out.push({ id: n.id, preview });
      }
    }
    const ch = n.children;
    if (Array.isArray(ch)) {
      for (const c of ch) walk(c);
    }
  }

  walk(root);
  return out;
}

/**
 * 从根到目标 id 的节点 id 链（含根与目标），用于逐级 expand。
 */
export function findAncestorIdPath(root: unknown, targetId: string, ancestors: string[] = []): string[] | null {
  if (!root || typeof root !== "object") return null;
  const n = root as { id?: string; children?: unknown[] };
  if (typeof n.id !== "string") return null;
  const path = [...ancestors, n.id];
  if (n.id === targetId) return path;
  const ch = n.children;
  if (!Array.isArray(ch)) return null;
  for (const c of ch) {
    const p = findAncestorIdPath(c, targetId, path);
    if (p) return p;
  }
  return null;
}
