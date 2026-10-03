type ThumbnailResult = import("./contract").ThumbnailResult;
type FolderStatus = import("./contract").FolderStatus;
type SortOrder = import("./contract").SortOrder;

const messages: Record<Exclude<FolderStatus, "videos">, string> = {
  empty: "This folder is empty. Choose another folder.",
  "no-videos":
    "No recognised video files in this folder. Subfolders are not included; choose the folder that directly contains your videos.",
  "invalid-path": "Enter a full folder path, such as C:\\Videos.",
  network:
    "Network folders are not supported. Choose a folder on this computer or on a USB drive.",
  "not-found":
    "This folder cannot be found. If it is on a USB drive, check that the drive is connected, or choose another folder.",
  "not-a-folder": "This path is a file, not a folder. Choose a folder.",
  "access-denied":
    "Windows denied access to this folder. Choose a folder you have permission to open.",
  unreadable:
    "Cannot read this folder. Check that it is connected and accessible, or choose another folder.",
};

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing UI element: ${id}`);
  return value as T;
}
const folderInput = element<HTMLInputElement>("folder");
const grid = element<HTMLUListElement>("grid");
const statusMessage = element<HTMLParagraphElement>("status");
const selected = element<HTMLSpanElement>("selected");
const scroller = element<HTMLElement>("browse");
const size = element<HTMLInputElement>("size");
const sizeValue = element<HTMLSpanElement>("size-value");
const sortField = element<HTMLSelectElement>("sort-field");
const sortDirection = element<HTMLSelectElement>("sort-direction");
const choose = element<HTMLButtonElement>("choose");
const cards = new Map<string, HTMLButtonElement>();
// Cards in grid order, for keyboard navigation.
let order: HTMLButtonElement[] = [];
// The one card in the tab order: Tab enters the grid here, arrows move it.
let current: HTMLButtonElement | undefined;
// Results may arrive before their cards are built.
const results = new Map<string, ThumbnailResult>();
// Entries within a viewport's height of the visible area.
const near = new Set<string>();
let selection = 0;

// Only entries near the viewport show their results. This bounds decoded image
// memory, and keeps extraction from re-laying out a large grid for offscreen
// entries; scrolling back shows stored results and reloads stills.
const observer = new IntersectionObserver(
  (changes) => {
    for (const change of changes) {
      const id = (change.target as HTMLElement).dataset.id ?? "";
      if (change.isIntersecting) {
        near.add(id);
        present(id);
      } else if (near.delete(id))
        cards.get(id)?.querySelector(".frame img")?.remove();
    }
    prioritizeNear();
  },
  { root: scroller, rootMargin: "100% 0px" },
);

// Asks for the missing thumbnails nearest the middle of the viewport first.
function prioritizeNear(): void {
  const view = scroller.getBoundingClientRect();
  const middle = view.top + view.height / 2;
  const distance = (id: string) => {
    const box = cards.get(id)?.getBoundingClientRect();
    return box ? Math.abs(box.top + box.height / 2 - middle) : Infinity;
  };
  const wanted = [...near].filter((id) => !results.has(id));
  const order = new Map(wanted.map((id) => [id, distance(id)]));
  window.browser.prioritize(
    wanted.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
  );
}

// Statuses of a folder that exists and could be read.
const listable = new Set<FolderStatus>(["videos", "empty", "no-videos"]);

// `restoring` is set when reopening the last session's folder at startup.
async function selectFolder(folder: string, restoring = false): Promise<void> {
  const request = ++selection;
  observer.disconnect();
  cards.clear();
  order = [];
  current = undefined;
  results.clear();
  near.clear();
  grid.replaceChildren();
  scroller.scrollTop = 0;
  statusMessage.textContent = "Reading folder…";
  const result = await window.browser.openFolder(folder);
  if (request !== selection) return;
  selected.textContent = result.folder;
  const status = result.status;
  if (status === "videos")
    statusMessage.textContent = `${result.entries.length} source ${result.entries.length === 1 ? "video" : "videos"}. Click a video, or press Enter on it, to open it in your default player.`;
  else if (restoring && !listable.has(status)) {
    statusMessage.textContent = `Your last selected folder is not available. ${messages[status]}`;
    // Offers the folder chooser; Enter or Space opens it.
    choose.focus();
  } else statusMessage.textContent = messages[status];
  const fragment = document.createDocumentFragment();
  for (const entry of result.entries) {
    const card = document.createElement("button");
    card.className = "video";
    card.dataset.id = entry.id;
    card.tabIndex = -1;
    card.setAttribute("aria-label", `Open ${entry.filename}`);
    const frame = document.createElement("div");
    frame.className = "frame";
    frame.append(placeholder("Loading thumbnail…"));
    // Hover or focus lays the full filename and detail over the card below.
    const text = document.createElement("span");
    text.className = "text";
    const body = document.createElement("span");
    body.className = "body";
    text.append(body);
    const filename = document.createElement("span");
    filename.className = "filename";
    filename.textContent = entry.filename;
    filename.title = entry.filename;
    const detail = document.createElement("span");
    detail.className = "detail";
    body.append(filename, detail);
    // The spoken counterpart of the frame and detail line.
    const description = document.createElement("span");
    description.className = "visually-hidden";
    description.id = `description-${entry.id}`;
    description.textContent = "Loading thumbnail…";
    card.setAttribute("aria-describedby", description.id);
    card.append(frame, text, description);
    card.addEventListener("click", () => {
      void window.browser.launch(entry.id).then((error) => {
        statusMessage.textContent = error
          ? `Cannot open ${entry.filename}: ${error}`
          : `Opened ${entry.filename} in your default player.`;
      });
    });
    cards.set(entry.id, card);
    order.push(card);
    const item = document.createElement("li");
    item.append(card);
    fragment.append(item);
  }
  grid.append(fragment);
  if (order[0]) makeCurrent(order[0]);
  for (const card of cards.values()) observer.observe(card);
}

// Shows an entry's thumbnail or reason, and its duration, if it is near the viewport.
function present(id: string): void {
  const card = cards.get(id);
  const result = results.get(id);
  const frame = card?.querySelector(".frame");
  const detail = card?.querySelector(".detail");
  const description = document.getElementById(`description-${id}`);
  if (!near.has(id) || !result || !frame || !detail || !description) return;
  if (!result.image)
    frame.replaceChildren(
      placeholder(result.reason ?? "Thumbnail unavailable"),
    );
  else if (!frame.querySelector("img")) {
    const image = document.createElement("img");
    image.crossOrigin = "anonymous";
    image.src = result.image;
    image.alt = `Thumbnail for ${card?.querySelector(".filename")?.textContent ?? ""}`;
    frame.replaceChildren(image);
  }
  // The duration label is omitted when it is not reliably known.
  const duration = result.duration
    ? formatDuration(result.duration)
    : undefined;
  const reason = result.reason ?? "";
  detail.textContent = [duration?.shown ?? "", reason]
    .filter(Boolean)
    .join(" ");
  description.textContent = [duration?.spoken ?? "", reason]
    .filter(Boolean)
    .join(". ");
}

function placeholder(message: string): HTMLSpanElement {
  const value = document.createElement("span");
  value.className = "placeholder";
  value.textContent = message;
  return value;
}

// A duration as shown (1:05 or 2:00:00) and as spoken ("Duration 1 minute 5 seconds").
function formatDuration(seconds: number): { shown: string; spoken: string } {
  const total = Math.floor(seconds);
  const parts: [number, string][] = [
    [Math.floor(total / 3600), "hour"],
    [Math.floor((total % 3600) / 60), "minute"],
    [total % 60, "second"],
  ];
  const [hours, minutes, secs] = parts.map(([value]) => value);
  const pad = (value = 0) => String(value).padStart(2, "0");
  const shown = hours
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
  const spoken = parts
    .filter(([value]) => value)
    .map(([value, unit]) => `${value} ${unit}${value === 1 ? "" : "s"}`);
  return {
    shown,
    spoken: `Duration ${spoken.join(" ") || "under 1 second"}`,
  };
}

function makeCurrent(card: HTMLButtonElement): void {
  if (current) current.tabIndex = -1;
  current = card;
  card.tabIndex = 0;
}

grid.addEventListener("focusin", (event) => {
  if (!(event.target instanceof HTMLButtonElement)) return;
  makeCurrent(event.target);
  // Keyboard focus also brings the full filename and reason into view. A click
  // leaves the browsing position alone.
  // Runs after the browser's own scroll to the focused entry.
  const card = event.target;
  if (card.matches(":focus-visible"))
    requestAnimationFrame(() => {
      revealText(card);
    });
});

// Scrolls the entry's text up into view, keeping its first line visible when
// the text is taller than the grid.
function revealText(card: HTMLButtonElement): void {
  const view = scroller.getBoundingClientRect();
  const text = card.querySelector(".body")?.getBoundingClientRect();
  if (!text || text.bottom <= view.bottom) return;
  scroller.scrollTop += Math.min(
    text.bottom - view.bottom,
    text.top - view.top,
  );
}

// Arrow keys, Home and End move focus between entries. Moving focus never
// launches; Enter or Space on the focused entry does, as a click.
grid.addEventListener("keydown", (event) => {
  if (!current || event.altKey || event.ctrlKey || event.metaKey) return;
  const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  const index = order.indexOf(current);
  const target = {
    ArrowLeft: index - 1,
    ArrowRight: index + 1,
    ArrowUp: index - columns,
    ArrowDown: index + columns,
    Home: 0,
    End: order.length - 1,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  const card = order[Math.max(0, Math.min(order.length - 1, target))];
  card?.focus();
});

// Keeps the browsing position while the size changes: the current entry when
// it is in view, otherwise the topmost visible entry, stays where it was.
function resize(width: number): void {
  const view = scroller.getBoundingClientRect();
  const shown = (card: HTMLButtonElement) => {
    const box = card.getBoundingClientRect();
    return box.bottom > view.top && box.top < view.bottom;
  };
  const visible = [...near]
    .map((id) => cards.get(id))
    .filter((card): card is HTMLButtonElement => !!card && shown(card));
  const anchor =
    current && shown(current)
      ? current
      : visible.sort(
          (a, b) =>
            a.getBoundingClientRect().top - b.getBoundingClientRect().top,
        )[0];
  const before = anchor?.getBoundingClientRect().top;
  document.documentElement.style.setProperty("--thumbnail", `${width}px`);
  sizeValue.textContent = `${width} px`;
  size.setAttribute("aria-valuetext", `${width} pixels wide`);
  if (!anchor || before === undefined) return;
  const after = anchor.getBoundingClientRect();
  let offset = after.top - before;
  // A larger current entry is brought fully into view where it fits.
  if (anchor === current) {
    const bottom = after.bottom - offset - view.bottom;
    if (bottom > 0) offset += Math.min(bottom, after.top - offset - view.top);
  }
  scroller.scrollTop += offset;
}
size.addEventListener("input", () => {
  resize(size.valueAsNumber);
});
// Saved once a value is chosen, not at every step while dragging.
size.addEventListener("change", () => {
  chosen.add(size);
  window.browser.setSize(size.valueAsNumber);
});

// Controls changed in this session; startup restoration leaves them alone.
const chosen = new Set<HTMLElement>();

function sortOrder(): SortOrder {
  return {
    field: sortField.value === "modified" ? "modified" : "name",
    direction:
      sortDirection.value === "descending" ? "descending" : "ascending",
  };
}

// Names each direction after what it means for the chosen field.
function nameDirections(): void {
  const [ascending, descending] =
    sortField.value === "modified"
      ? ["Oldest first", "Newest first"]
      : ["A to Z", "Z to A"];
  const [first, second] = sortDirection.options;
  if (first) first.text = ascending ?? "";
  if (second) second.text = descending ?? "";
}

// Reorders the existing entries, keeping their thumbnails and results, and
// returns to the start of the grid.
async function applySort(): Promise<void> {
  nameDirections();
  const request = selection;
  const ids = await window.browser.sort(sortOrder());
  // A folder still being read is listed in the new order instead.
  if (request !== selection || ids.length !== order.length) return;
  order = ids
    .map((id) => cards.get(id))
    .filter((card): card is HTMLButtonElement => !!card);
  grid.replaceChildren(...order.map((card) => card.parentElement ?? card));
  scroller.scrollTop = 0;
  if (order[0]) makeCurrent(order[0]);
  statusMessage.textContent = `Sorted by ${sortField.selectedOptions[0]?.text.toLowerCase() ?? ""}, ${sortDirection.selectedOptions[0]?.text.toLowerCase() ?? ""}.`;
}
for (const control of [sortField, sortDirection])
  control.addEventListener("change", () => {
    chosen.add(control);
    void applySort();
  });
element<HTMLFormElement>("folder-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void selectFolder(folderInput.value);
});
choose.addEventListener("click", () => {
  void window.browser.chooseFolder().then((folder) => {
    if (folder) {
      folderInput.value = folder;
      void selectFolder(folder);
    }
  });
});
window.browser.onThumbnail((result) => {
  results.set(result.id, result);
  present(result.id);
});

// Restores the last session's size and sort order, then its folder.
void window.browser.preferences().then((saved) => {
  if (!chosen.has(size)) {
    size.value = String(saved.size);
    resize(saved.size);
  }
  if (!chosen.has(sortField)) sortField.value = saved.sort.field;
  if (!chosen.has(sortDirection)) sortDirection.value = saved.sort.direction;
  nameDirections();
  // The user may already have chosen a folder.
  if (saved.folder && selection === 0) {
    folderInput.value = saved.folder;
    void selectFolder(saved.folder, true);
  }
});
