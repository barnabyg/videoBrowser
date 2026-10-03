export interface VideoEntry {
  id: string;
  filename: string;
}
export interface ThumbnailResult {
  id: string;
  image?: string;
  duration?: number;
  reason?: string;
}
// Why a selected folder has these entries, or why it could not be listed.
export type FolderStatus =
  | "videos"
  | "empty"
  | "no-videos"
  | "invalid-path"
  | "network"
  | "not-found"
  | "not-a-folder"
  | "access-denied"
  | "unreadable";
export interface FolderResult {
  folder: string;
  status: FolderStatus;
  entries: VideoEntry[];
}
export interface BrowserApi {
  chooseFolder(): Promise<string | undefined>;
  openFolder(folder: string): Promise<FolderResult>;
  /** Opens the entry's source video in its Windows default application. Resolves with an error message, or "" on success. */
  launch(id: string): Promise<string>;
  onThumbnail(callback: (result: ThumbnailResult) => void): void;
}
declare global {
  interface Window {
    browser: BrowserApi;
  }
}
