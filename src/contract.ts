export interface VideoEntry {
  id: string;
  filename: string;
}
export interface ThumbnailResult {
  id: string;
  /** A thumbnail:// URL of the stored still, or a data URL when it could not be stored. */
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
  /** After Refresh: how the listing differs from the entries shown before. */
  changes?: FolderChanges;
}
export interface FolderChanges {
  added: number;
  removed: number;
  /** Source videos still present whose size or modification time changed. */
  changed: number;
}
export interface SortOrder {
  field: "name" | "modified";
  direction: "ascending" | "descending";
}
// Browsing choices remembered between sessions.
export interface Preferences {
  /** The last selected folder that could be listed. */
  folder?: string;
  /** Thumbnail width in logical pixels. */
  size: number;
  sort: SortOrder;
}
export interface BrowserApi {
  /** The saved preferences, or the initial ones for a fresh user profile. */
  preferences(): Promise<Preferences>;
  chooseFolder(): Promise<string | undefined>;
  /** Lists the folder in the saved sort order, and remembers it once it can be listed. */
  openFolder(folder: string): Promise<FolderResult>;
  /**
   * Lists the selected folder again. Unchanged source videos keep their entry
   * ids and results; added, changed and previously failed ones get new ids.
   */
  refresh(): Promise<FolderResult>;
  /** Remembers the sort order and resolves with the selected folder's entry ids in it. */
  sort(order: SortOrder): Promise<string[]>;
  /** Remembers the thumbnail size. */
  setSize(width: number): void;
  /** Opens the entry's source video in its Windows default application. Resolves with an error message, or "" on success. */
  launch(id: string): Promise<string>;
  /** Extracts these entries' thumbnails before others, in this order. */
  prioritize(ids: string[]): void;
  onThumbnail(callback: (result: ThumbnailResult) => void): void;
}
declare global {
  interface Window {
    browser: BrowserApi;
  }
}
