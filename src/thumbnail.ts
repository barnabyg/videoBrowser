// Extracts one automatic thumbnail and a reliable duration for a source video
// within a bounded elapsed budget, explaining any failure for its entry.
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";

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

async function run(
  tool: Tool,
  args: string[],
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Aborting the signal terminates the process.
    const child = spawn(tool.command, [...tool.args, ...args], {
      windowsHide: true,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(error || "Thumbnail process failed")),
    );
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
