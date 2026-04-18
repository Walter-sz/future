export type StudyTabType = "pinned_default" | "mindmap" | "folder";

export type StudyTabRow = {
  id: number;
  title: string;
  tabType: StudyTabType;
  sortOrder: number;
  configJson: string;
  createdAt: number;
  updatedAt: number;
  /** 仅 mindmap：列表接口附带，便于删除确认与界面展示落盘位置 */
  mindmapStorage?: {
    relPath: string;
    absolutePath: string;
  };
};

export type MindmapTabConfig = {
  mindmapDataRelPath?: string;
  /** 打开本地 JSON 时的服务端绝对路径，不与 mindmapDataRelPath 同时用于新建副本 */
  mindmapExternalJsonPath?: string;
  snapshotFormat: "mind-elixir-v1";
};

export type FolderTabConfig = {
  serverPath: string;
};

export function parseStudyTabConfig(raw: string): Record<string, unknown> {
  try {
    const j = JSON.parse(raw || "{}");
    return typeof j === "object" && j !== null && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function isPinnedTab(tabType: string): boolean {
  return tabType === "pinned_default";
}
