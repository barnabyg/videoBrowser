// Lists the source videos directly contained in a selected folder. Listing depends
// only on the filename extension; decoding and playback are separate capabilities.
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { FolderStatus } from "./contract";

export const videoExtensions = new Set([
  ".mp4",
  ".m4v",
  ".mkv",
  ".webm",
  ".mov",
  ".avi",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".ts",
  ".mts",
  ".m2ts",
  ".3gp",
  ".h264",
]);

export interface ListedVideo {
  filename: string;
  source: string;
}

export interface FolderListing {
  kind: FolderStatus;
  entries: ListedVideo[];
}

// UNC paths (\\server\share, \\?\UNC\server\share) are network shares; device
// paths to a drive letter (\\?\C:\, \\.\C:\) are local.
function isNetworkPath(folder: string): boolean {
  return /^[\\/]{2}/.test(folder) && !/^[\\/]{2}[?.][\\/][a-z]:/i.test(folder);
}

const failures: Record<string, FolderListing["kind"]> = {
  ENOENT: "not-found",
  ENOTDIR: "not-a-folder",
  EACCES: "access-denied",
  EPERM: "access-denied",
};

export async function listFolder(folder: string): Promise<FolderListing> {
  if (!path.isAbsolute(folder)) return { kind: "invalid-path", entries: [] };
  if (isNetworkPath(folder)) return { kind: "network", entries: [] };
  let files;
  try {
    files = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    return { kind: failures[code] ?? "unreadable", entries: [] };
  }
  if (!files.length) return { kind: "empty", entries: [] };
  const entries = files
    .filter(
      (file) =>
        file.isFile() &&
        videoExtensions.has(path.extname(file.name).toLowerCase()),
    )
    .map((file) => ({
      filename: file.name,
      source: path.join(folder, file.name),
    }));
  return { kind: entries.length ? "videos" : "no-videos", entries };
}
