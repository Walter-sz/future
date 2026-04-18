/**
 * 解析 JSON 对象；合法则返回 mind-elixir-v1 包装，否则 null。
 */
export function tryMindMapFileV1FromParsed(parsed: unknown): {
  format: "mind-elixir-v1";
  version: 1;
  data: unknown;
} | null {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if (o.format === "mind-elixir-v1" && o.version === 1 && o.data !== undefined) {
      return { format: "mind-elixir-v1", version: 1, data: o.data };
    }
    if (o.nodeData && typeof o.nodeData === "object") {
      return { format: "mind-elixir-v1", version: 1, data: parsed };
    }
  }
  return null;
}

/**
 * 从用户选择的 JSON 文件解析出 Mind Elixir `getData()` 可用的 data。
 * 支持：① 本应用保存的 mind-elixir-v1 整文件；② 仅含 nodeData 的裸数据。
 */
export function mindMapDataFromImportedJson(parsed: unknown): unknown {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if (o.format === "mind-elixir-v1" && o.version === 1 && o.data !== undefined) {
      return o.data;
    }
    if (o.nodeData && typeof o.nodeData === "object") {
      return parsed;
    }
  }
  throw new Error("无法识别：请使用 Mind Elixir 脑图 JSON，或本应用导出的 mind-elixir-v1 文件");
}
