import JSZip from "jszip";

type ZenTopic = {
  id?: string;
  title?: string;
  children?: {
    attached?: ZenTopic[];
    /** 少数导出里子节点在此 */
    detached?: ZenTopic[];
  };
};

type ZenSheet = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 从 sheet 对象上取根主题（不同版本字段名不同） */
function rootTopicFromSheet(sheet: ZenSheet): ZenTopic | undefined {
  const r = sheet.rootTopic ?? sheet.primaryTopic ?? sheet.mainTopic;
  if (r && isRecord(r)) return r as ZenTopic;
  return undefined;
}

/** 从 content.json 解析出的值中提取第一张表上的根主题 */
function extractRootTopicFromXmindContentJson(json: unknown): ZenTopic | undefined {
  // 1) 根即为 sheet 数组（常见于 XMind Zen / xmindparser 等）
  if (Array.isArray(json)) {
    for (const item of json) {
      if (!isRecord(item)) continue;
      const root = rootTopicFromSheet(item);
      if (root) return root;
    }
    return undefined;
  }
  if (!isRecord(json)) return undefined;

  // 2) 包一层对象：sheetArray / sheets / sheetList
  const candidates = [json.sheetArray, json.sheets, json.sheetList].find(
    (v): v is unknown[] => Array.isArray(v) && v.length > 0
  );
  if (candidates) {
    for (const sheet of candidates) {
      if (!isRecord(sheet)) continue;
      const root = rootTopicFromSheet(sheet);
      if (root) return root;
    }
  }

  // 3) 单页直接挂在根上
  const direct = rootTopicFromSheet(json);
  if (direct) return direct;

  return undefined;
}

/**
 * 将 XMind Zen（content.json）根主题转为 Mind Elixir 数据（仅 nodeData 树）。
 */
export function zenRootTopicToMindElixirData(
  root: ZenTopic | undefined,
  fallbackTitle: string
): Record<string, unknown> {
  const rid = root?.id ?? `root-${Math.random().toString(36).slice(2, 12)}`;
  const topic = (root?.title ?? fallbackTitle).trim() || fallbackTitle;
  const attached = attachedChildren(root ?? {});
  const children = attached.map((t) => zenTopicToNode(t)).filter(Boolean) as Record<string, unknown>[];
  return {
    nodeData: {
      id: rid,
      topic,
      children,
    },
    arrows: [],
    summaries: [],
  };
}

function attachedChildren(t: ZenTopic): ZenTopic[] {
  const ch = t.children;
  if (!ch) return [];
  const a = ch.attached ?? [];
  const d = ch.detached ?? [];
  return [...a, ...d];
}

function zenTopicToNode(t: ZenTopic): Record<string, unknown> | null {
  if (!t) return null;
  const id = t.id ?? `n-${Math.random().toString(36).slice(2, 10)}`;
  const topic = (t.title ?? "").trim() || "未命名";
  const attached = attachedChildren(t);
  const children = attached.map((c) => zenTopicToNode(c)).filter(Boolean) as Record<string, unknown>[];
  return {
    id,
    topic,
    ...(children.length ? { children } : {}),
  };
}

/**
 * 从 .xmind 文件（zip）解析并返回 Mind Elixir 数据；失败时抛出 Error。
 */
export async function parseXmindFileToMindElixirData(file: File, fallbackTitle: string): Promise<Record<string, unknown>> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const contentFile = zip.file("content.json");
  if (!contentFile) {
    throw new Error("未找到 content.json（仅支持 XMind Zen 格式）");
  }
  const text = await contentFile.async("string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("content.json 不是合法 JSON");
  }
  const root = extractRootTopicFromXmindContentJson(parsed);
  if (!root) {
    throw new Error(
      "无法从 content.json 解析根主题。请确认文件为 XMind 导出；若仍失败，可能是旧版 XMind 8（workbook.xml）格式，可尝试用 XMind 另存为新版 .xmind"
    );
  }
  return zenRootTopicToMindElixirData(root, fallbackTitle);
}
