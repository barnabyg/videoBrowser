import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  access,
  copyFile,
  readdir,
} from "node:fs/promises";
import { extract } from "@electron-internal/extract-zip";
import path from "node:path";

export const toolRoot = path.resolve(".tools/ffmpeg");
const archive = path.resolve(".cache/ffmpeg-9.0.2.zip");
const sha256 =
  "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
const url =
  "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip";
await mkdir(".cache", { recursive: true });
try {
  await access(archive);
} catch {
  console.log(`Downloading pinned thumbnail tools: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`FFmpeg download: ${response.status}`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
}
if (
  createHash("sha256")
    .update(await readFile(archive))
    .digest("hex") !== sha256
)
  throw new Error("FFmpeg archive checksum mismatch");
try {
  await access(path.join(toolRoot, "bin/ffprobe.exe"));
} catch {
  await mkdir(toolRoot, { recursive: true });
  await extract(archive, { dir: path.resolve(".tools/extracted") });
  const [folder] = await readdir(".tools/extracted");
  if (!folder) throw new Error("Empty FFmpeg archive");
  await mkdir(path.join(toolRoot, "bin"), { recursive: true });
  for (const name of ["ffmpeg.exe", "ffprobe.exe"])
    await copyFile(
      path.join(".tools/extracted", folder, "bin", name),
      path.join(toolRoot, "bin", name),
    );
  for (const name of ["LICENSE", "README.txt"])
    await copyFile(
      path.join(".tools/extracted", folder, name),
      path.join(toolRoot, name),
    );
}
console.log("FFmpeg 9.0.2 archive checksum verified.");
