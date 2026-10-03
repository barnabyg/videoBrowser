// Extracts one automatic thumbnail and a reliable duration for a source video
// within a bounded elapsed budget, explaining any failure for its entry.
import { open } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { nativeImage } from "electron";
import type {
  ProcessExit,
  ProcessMessage,
  ProcessRequest,
} from "./process-worker";

export interface Preview {
  image?: Buffer;
  duration?: number;
  reason?: string;
}

/** An executable plus leading arguments; the media arguments follow. */
export interface Tool {
  command: string;
  args: readonly string[];
}
/** The probe (duration and streams) and still-extraction tools. */
export interface Tools {
  probe: Tool;
  extract: Tool;
}

/** The ffprobe and ffmpeg executables in `folder`. */
export function bundledTools(folder: string): Tools {
  return {
    probe: { command: path.join(folder, "ffprobe.exe"), args: [] },
    extract: { command: path.join(folder, "ffmpeg.exe"), args: [] },
  };
}

/**
 * Describes how a thumbnail is generated. Change it whenever the positions,
 * dark-frame rule, scaling or image format change, so stored thumbnails made
 * the old way are not reused.
 */
export const recipe =
  "png 640 max; 10%, 50%, first or first, 1 s, 5 s; dark < 12/255";

/** One elapsed budget for probing and every fallback attempt of a job. */
export const budgetMs = 30_000;

const unavailable = "Thumbnail unavailable:";
const stillOpen = "You can still open it in your default player.";
const reasons = {
  unreadable: `${unavailable} this file cannot be read. Check that you have permission and that its drive is connected. ${stillOpen}`,
  noPicture: `${unavailable} this file has no video picture to show. ${stillOpen}`,
  unrecognised: `${unavailable} this file is not recognised as a supported video and may be damaged. ${stillOpen}`,
  undecodable: `${unavailable} the thumbnail engine could not decode a picture from this video. It may be damaged or use an unsupported format. ${stillOpen}`,
  timeout: `${unavailable} processing took longer than ${budgetMs / 1000} seconds and was stopped. ${stillOpen}`,
  dark: "Only dark frames were found.",
  cancelled: "Folder changed.",
};

interface Job {
  /** Known once the worker has started the process. */
  pid?: number;
  settle(exit: ProcessExit): void;
  started(pid: number): void;
}
const jobs = new Map<number, Job>();
let nextJob = 0;
let launcher: Worker | undefined;
const waiting: (() => void)[] = [];

/**
 * Resolves once every requested tool process has exited, or after `timeoutMs`.
 * A process aborted before the worker reported its id is stopped when the id
 * arrives, so waiting before quitting keeps it from outliving the application.
 */
export function processesStopped(timeoutMs: number): Promise<void> {
  if (!jobs.size) return Promise.resolve();
  return new Promise((resolve) => {
    waiting.push(resolve);
    setTimeout(resolve, timeoutMs).unref();
  });
}

// Tool processes start on a worker thread; see process-worker.ts.
function processLauncher(): Worker {
  if (launcher) return launcher;
  const worker = new Worker(path.join(__dirname, "process-worker.js"));
  // Pending jobs never keep the application running.
  worker.unref();
  worker.on("message", (message: ProcessMessage) => {
    const job = jobs.get(message.id);
    if (!job) return;
    if ("pid" in message) job.started(message.pid);
    else {
      jobs.delete(message.id);
      job.settle(message);
      if (!jobs.size) for (const idle of waiting.splice(0)) idle();
    }
  });
  worker.on("error", (error: Error) => {
    launcher = undefined;
    for (const [id, job] of jobs) {
      // Its processes outlive it otherwise.
      if (job.pid !== undefined) stop(job.pid);
      jobs.delete(id);
      job.settle({
        id,
        exit: null,
        stdout: new Uint8Array(),
        error: error.message,
      });
    }
    for (const idle of waiting.splice(0)) idle();
  });
  launcher = worker;
  return worker;
}

function stop(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    /* It has already exited. */
  }
}

async function run(
  tool: Tool,
  args: string[],
  signal: AbortSignal,
): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const id = nextJob++;
    let pid: number | undefined;
    // Aborting the signal terminates the process from this thread at once, so
    // closing the window does not leave it running.
    const abort = () => {
      if (pid !== undefined) stop(pid);
    };
    signal.addEventListener("abort", abort, { once: true });
    jobs.set(id, {
      started(started) {
        pid = started;
        this.pid = started;
        if (signal.aborted) stop(started);
      },
      settle({ exit, stdout, error }) {
        signal.removeEventListener("abort", abort);
        if (exit === 0) resolve(Buffer.from(stdout));
        else reject(new Error(error || "Thumbnail process failed"));
      },
    });
    const request: ProcessRequest = {
      id,
      command: tool.command,
      args: [...tool.args, ...args],
    };
    processLauncher().postMessage(request);
  });
}

// A hung read, e.g. on a stalled removable drive, gives up when `signal` fires.
async function readable(source: string, signal: AbortSignal): Promise<boolean> {
  const check = async () => {
    const file = await open(source, "r");
    try {
      await file.read(Buffer.alloc(1), 0, 1, 0);
    } finally {
      await file.close();
    }
  };
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
  try {
    await Promise.race([check(), aborted]);
    return true;
  } catch {
    return false;
  }
}

interface Probe {
  duration?: number;
  video: boolean;
}

// Resolves undefined when the source is not recognised as media.
async function probe(
  source: string,
  tools: Tools,
  signal: AbortSignal,
): Promise<Probe | undefined> {
  let metadata: unknown;
  try {
    const output = await run(
      tools.probe,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        source,
      ],
      signal,
    );
    metadata = JSON.parse(output.toString());
  } catch {
    return undefined;
  }
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const streams =
    "streams" in metadata && Array.isArray(metadata.streams)
      ? (metadata.streams as unknown[])
      : [];
  if (!streams.length) return undefined;
  const video = streams.some(
    (stream) =>
      typeof stream === "object" &&
      stream !== null &&
      "codec_type" in stream &&
      stream.codec_type === "video",
  );
  let duration: number | undefined;
  if ("format" in metadata) {
    const format = metadata.format;
    if (
      typeof format === "object" &&
      format !== null &&
      "duration" in format &&
      typeof format.duration === "string"
    ) {
      const value = Number(format.duration);
      if (Number.isFinite(value) && value > 0) duration = value;
    }
  }
  return { duration, video };
}

function isBlack(image: Buffer): boolean {
  const pixels = nativeImage
    .createFromBuffer(image)
    .resize({ width: 32, height: 32 })
    .toBitmap();
  if (!pixels.length) throw new Error("Unreadable extracted image");
  let brightness = 0;
  for (let i = 0; i < pixels.length; i += 4)
    brightness +=
      ((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)) / 3;
  return brightness / (pixels.length / 4) < 12;
}

/**
 * Probes a source video, then tries 10%, 50% and the first frame of a reliable
 * duration, or the first frame, 1 s and 5 s without one, keeping the first
 * non-dark still. The whole job shares one `budgetMs` elapsed budget; `cancelled`
 * stops it early. Any running tool process is terminated when either fires.
 */
export async function extractPreview(
  source: string,
  tools: Tools,
  cancelled: AbortSignal,
): Promise<Preview> {
  const deadline = AbortSignal.timeout(budgetMs);
  const signal = AbortSignal.any([deadline, cancelled]);
  // Cancellation and the deadline explain a failure better than its symptoms.
  const outcome = (preview: Preview): Preview => {
    if (cancelled.aborted) return { reason: reasons.cancelled };
    if (deadline.aborted)
      return { duration: preview.duration, reason: reasons.timeout };
    return preview;
  };
  if (!(await readable(source, signal)))
    return outcome({ reason: reasons.unreadable });
  // A failed probe still permits bounded extraction while the budget remains.
  const media = await probe(source, tools, signal);
  const duration = media?.duration;
  if (media && !media.video)
    return outcome({ duration, reason: reasons.noPicture });
  const positions = duration ? [duration * 0.1, duration * 0.5, 0] : [0, 1, 5];
  let lastImage: Buffer | undefined;
  for (const position of positions) {
    if (signal.aborted) break;
    try {
      const seek = position === 0 ? [] : ["-ss", String(position)];
      const image = await run(
        tools.extract,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-protocol_whitelist",
          "file,pipe",
          ...seek,
          "-i",
          source,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-vf",
          "scale=640:640:force_original_aspect_ratio=decrease",
          "-threads",
          "1",
          "-f",
          "image2pipe",
          "-c:v",
          "png",
          "pipe:1",
        ],
        signal,
      );
      if (!image.length) continue;
      const dark = isBlack(image);
      lastImage = image;
      if (!dark) return { image, duration };
    } catch {
      /* A later position can succeed on a damaged or non-seekable source. */
    }
  }
  // A dark still is better than none, even when the budget has run out.
  if (lastImage && !cancelled.aborted)
    return { image: lastImage, duration, reason: reasons.dark };
  return outcome({
    duration,
    reason: media ? reasons.undecodable : reasons.unrecognised,
  });
}
