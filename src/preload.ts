import { contextBridge, ipcRenderer } from "electron";
import type { BrowserApi, ThumbnailResult } from "./contract";
const api: BrowserApi = {
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  openFolder: (folder) => ipcRenderer.invoke("open-folder", folder),
  launch: (id) => ipcRenderer.invoke("launch", id),
  onThumbnail: (callback) => {
    ipcRenderer.on("thumbnail", (_event, result: ThumbnailResult) =>
      callback(result),
    );
  },
};
contextBridge.exposeInMainWorld("browser", api);
