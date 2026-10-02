import { spawn } from "node:child_process";
import path from "node:path";
import { nativeImage } from "electron";

export interface Preview {
  image?: Buffer;
  duration?: number;
  reason?: string;
}

async function run(
  executable: string,
  args: string[],
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
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

export async function extractPreview(
  source: string,
  tools: string,
  cancelled: AbortSignal,
): Promise<Preview> {
  const deadline = AbortSignal.timeout(30_000);
  const signal = AbortSignal.any([deadline, cancelled]);
  let duration: number | undefined;
  try {
    const output = await run(
      path.join(tools, "ffprobe.exe"),
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        source,
      ],
      signal,
    );
    const metadata: unknown = JSON.parse(output.toString());
    if (
      typeof metadata === "object" &&
      metadata !== null &&
      "format" in metadata
    ) {
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
  } catch {
    /* A failed probe still permits bounded extraction while the budget remains. */
  }
  const positions = duration ? [duration * 0.1, duration * 0.5, 0] : [0, 1, 5];
  let lastImage: Buffer | undefined;
  for (const position of positions) {
    if (signal.aborted) break;
    try {
      const seek = position === 0 ? [] : ["-ss", String(position)];
      const image = await run(
        path.join(tools, "ffmpeg.exe"),
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
      lastImage = image;
      if (!isBlack(image)) return { image, duration };
    } catch {
      /* A later position can succeed on a damaged or non-seekable source. */
    }
  }
  if (cancelled.aborted) return { reason: "Folder changed." };
  if (deadline.aborted)
    return { duration, reason: "Thumbnail processing exceeded 30 seconds." };
  if (lastImage)
    return {
      image: lastImage,
      duration,
      reason: "Only dark frames were found.",
    };
  return {
    duration,
    reason: "Thumbnail unavailable. You can still open this video.",
  };
}
