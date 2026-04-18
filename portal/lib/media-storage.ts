import fs from "fs";
import path from "path";
import { getPersistenceRoot } from "@/lib/persistence";

export function getMediaDataRoot() {
  return path.join(getPersistenceRoot(), "media");
}

export function getMediaMetadataCacheDir() {
  return path.join(getMediaDataRoot(), "metadata");
}

export function getMediaAgentRunsDir() {
  return path.join(getMediaDataRoot(), "agent-runs");
}

export function getMediaAgentRunsIndexPath() {
  return path.join(getMediaAgentRunsDir(), "runs-index.json");
}

export function ensureMediaDataDirs() {
  fs.mkdirSync(getMediaDataRoot(), { recursive: true });
  fs.mkdirSync(getMediaMetadataCacheDir(), { recursive: true });
  fs.mkdirSync(getMediaAgentRunsDir(), { recursive: true });
}

/** 持续学习模块：脑图等在 walter_data/study/ */
export function getStudyDataRoot() {
  return path.join(getPersistenceRoot(), "study");
}

export function getStudyMindmapsDir() {
  return path.join(getStudyDataRoot(), "mindmaps");
}

export function ensureStudyDataDirs() {
  fs.mkdirSync(getStudyMindmapsDir(), { recursive: true });
}
