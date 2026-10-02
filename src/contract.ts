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
export interface FolderResult {
  folder: string;
  entries: VideoEntry[];
  error?: string;
}
export interface BrowserApi {
  chooseFolder(): Promise<string | undefined>;
  openFolder(folder: string): Promise<FolderResult>;
  launch(id: string): Promise<string>;
  onThumbnail(callback: (result: ThumbnailResult) => void): void;
}
declare global {
  interface Window {
    browser: BrowserApi;
  }
}
