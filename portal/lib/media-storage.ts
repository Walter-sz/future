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
