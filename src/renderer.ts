type ThumbnailResult = import("./contract").ThumbnailResult;

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing UI element: ${id}`);
  return value as T;
}
const folderInput = element<HTMLInputElement>("folder");
const grid = element<HTMLDivElement>("grid");
const statusMessage = element<HTMLParagraphElement>("status");
const selected = element<HTMLParagraphElement>("selected");
const cards = new Map<string, HTMLButtonElement>();
const earlyResults = new Map<string, ThumbnailResult>();
let selection = 0;

async function selectFolder(folder: string): Promise<void> {
  const current = ++selection;
  cards.clear();
  earlyResults.clear();
  grid.replaceChildren();
  statusMessage.textContent = "Reading folder…";
  const result = await window.browser.openFolder(folder);
  if (current !== selection) return;
  selected.textContent = result.folder;
  statusMessage.textContent =
    result.error ??
    (result.entries.length
      ? `${result.entries.length} source videos. Click a video to open it in your default player.`
      : "No recognised video files in this folder.");
  const fragment = document.createDocumentFragment();
  for (const entry of result.entries) {
    const card = document.createElement("button");
    card.className = "video";
    card.setAttribute("aria-label", `Open ${entry.filename}`);
    const frame = document.createElement("div");
    frame.className = "frame";
    frame.textContent = "Loading thumbnail…";
    const name = document.createElement("span");
    name.className = "filename";
    name.textContent = entry.filename;
    name.title = entry.filename;
    const detail = document.createElement("span");
    detail.className = "detail";
    card.append(frame, name, detail);
    card.addEventListener("click", () => {
      void window.browser.launch(entry.id).then((error) => {
        statusMessage.textContent = error
          ? `Cannot open ${entry.filename}: ${error}`
          : `Opened ${entry.filename} in your default player.`;
      });
    });
    cards.set(entry.id, card);
    fragment.append(card);
  }
  grid.append(fragment);
  for (const result of earlyResults.values()) showThumbnail(result);
  earlyResults.clear();
}

function showThumbnail(result: ThumbnailResult): void {
  const card = cards.get(result.id);
  if (!card) {
    earlyResults.set(result.id, result);
    return;
  }
  const frame = card.querySelector(".frame");
  const detail = card.querySelector(".detail");
  if (!frame || !detail) return;
  if (result.image) {
    const image = document.createElement("img");
    image.src = result.image;
    image.alt = `Thumbnail for ${card.querySelector(".filename")?.textContent ?? ""}`;
    frame.replaceChildren(image);
  } else frame.textContent = result.reason ?? "Thumbnail unavailable";
  const duration = result.duration;
  detail.textContent = duration
    ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`
    : "";
  if (result.reason) {
    detail.textContent += ` ${result.reason}`;
  }
}
element<HTMLFormElement>("folder-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void selectFolder(folderInput.value);
});
element<HTMLButtonElement>("choose").addEventListener("click", () => {
  void window.browser.chooseFolder().then((folder) => {
    if (folder) {
      folderInput.value = folder;
      void selectFolder(folder);
    }
  });
});
window.browser.onThumbnail(showThumbnail);
