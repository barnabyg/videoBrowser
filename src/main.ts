import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readdir, access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { extractPreview } from "./thumbnail";
import type { FolderResult, VideoEntry, ThumbnailResult } from "./contract";

const extensions = new Set([
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
let window: BrowserWindow;
let work = new AbortController();
let sources = new Map<string, string>();
// A separate test entry point uses this exported app boundary to select a disposable extension.
export function addFixtureExtension(extension: string): void {
  extensions.add(extension);
}
const state = process.env.VIDEO_BROWSER_STATE;
app.setPath(
  "userData",
  path.resolve(
    state ??
      path.join(
        process.env.LOCALAPPDATA ?? app.getPath("appData"),
        "video-browser",
      ),
  ),
);

async function openFolder(folder: unknown): Promise<FolderResult> {
  if (typeof folder !== "string" || !path.isAbsolute(folder))
    return { folder: "", entries: [], error: "Enter an absolute folder path." };
  work.abort();
  work = new AbortController();
  sources = new Map();
  const signal = work.signal;
  try {
    const files = await readdir(folder, { withFileTypes: true });
    if (signal.aborted) return { folder, entries: [] };
    const entries: VideoEntry[] = files
      .filter(
        (file) =>
          file.isFile() &&
          extensions.has(path.extname(file.name).toLowerCase()),
      )
      .map((file) => {
        const id = randomUUID();
        sources.set(id, path.join(folder, file.name));
        return { id, filename: file.name };
      });
    const pending = new Map(sources);
    // Start after the IPC response, allowing the renderer to display filenames first.
    setTimeout(() => {
      void processThumbnails(pending, signal);
    }, 0);
    return { folder, entries };
  } catch {
    return {
      folder,
      entries: [],
      error:
        "Cannot read this folder. Check that it is connected and accessible.",
    };
  }
}

async function processThumbnails(
  pending: Map<string, string>,
  signal: AbortSignal,
): Promise<void> {
  const tools = app.isPackaged
    ? path.join(process.resourcesPath, "tools")
    : path.resolve(".tools/ffmpeg/bin");
  const cache = path.join(app.getPath("userData"), "thumbnails");
  try {
    await mkdir(cache, { recursive: true });
    for (const [id, source] of pending) {
      if (signal.aborted) break;
      const preview = await extractPreview(source, tools, signal);
      if (signal.aborted || window.isDestroyed()) break;
      const result: ThumbnailResult = {
        id,
        duration: preview.duration,
        reason: preview.reason,
      };
      if (preview.image) {
        await writeFile(path.join(cache, `${id}.png`), preview.image);
        result.image = `data:image/png;base64,${preview.image.toString("base64")}`;
      }
      window.webContents.send("thumbnail", result);
    }
  } catch {
    if (!signal.aborted && !window.isDestroyed())
      for (const id of pending.keys())
        window.webContents.send("thumbnail", {
          id,
          reason:
            "Thumbnail storage is unavailable. You can still open this video.",
        });
  }
}

void app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: "Video Browser",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  function validateSender(event: Electron.IpcMainInvokeEvent): void {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Untrusted IPC sender");
  }
  ipcMain.handle("choose-folder", async (event) => {
    validateSender(event);
    const result = await dialog.showOpenDialog(window, {
      title: "Select a video folder",
      properties: ["openDirectory"],
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("open-folder", (event, folder: unknown) => {
    validateSender(event);
    return openFolder(folder);
  });
  ipcMain.handle("launch", async (event, id: unknown) => {
    validateSender(event);
    if (typeof id !== "string" || !sources.has(id))
      return "This entry is no longer in the selected folder.";
    const source = sources.get(id);
    if (!source) return "Source video is unavailable.";
    try {
      await access(source);
      return await shell.openPath(source);
    } catch {
      return "Cannot open this video. Check that the file is available and a default player is installed.";
    }
  });
  await window.loadFile(path.join(__dirname, "index.html"));
});
app.on("window-all-closed", () => {
  work.abort();
  app.quit();
});
