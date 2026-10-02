import {
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import yazl from "yazl";

const require = createRequire(import.meta.url);
process.env.electron_config_cache = path.resolve(".cache/electron");
const runtime = path.dirname(require("electron"));
const output = path.resolve("dist/VideoBrowser-win32-x64");
// Delete only this script's fixed build output, inside this checkout's dist directory.
if (!output.startsWith(path.resolve("dist") + path.sep))
  throw new Error("Invalid package output");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(runtime, output, { recursive: true });
await rename(
  path.join(output, "electron.exe"),
  path.join(output, "VideoBrowser.exe"),
);
const application = path.join(output, "resources/app");
await mkdir(application, { recursive: true });
await cp("build", path.join(application, "build"), { recursive: true });
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  path.join(application, "package.json"),
  JSON.stringify({ name: pkg.name, version: pkg.version, main: pkg.main }),
);
await cp(".tools/ffmpeg/bin", path.join(output, "resources/tools"), {
  recursive: true,
});
await mkdir(path.join(output, "licenses/ffmpeg"), { recursive: true });
for (const name of ["LICENSE", "README.txt"])
  await cp(
    path.join(".tools/ffmpeg", name),
    path.join(output, "licenses/ffmpeg", name),
  );
await cp("docs/dependencies.md", path.join(output, "THIRD-PARTY-NOTICES.md"));
await cp("docs/package-readme.md", path.join(output, "README.md"));
const zip = new yazl.ZipFile();
async function addFolder(folder, relative) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const child = path.join(folder, entry.name);
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await addFolder(child, name);
    else zip.addFile(child, name);
  }
}
await addFolder(output, "VideoBrowser-win32-x64");
zip.end();
await pipeline(
  zip.outputStream,
  createWriteStream("dist/VideoBrowser-win32-x64.zip"),
);
console.log("Unzip-and-run package: dist/VideoBrowser-win32-x64.zip");
