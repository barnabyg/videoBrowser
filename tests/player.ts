import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Registers a disposable extension whose Windows default handler records the
// launched path in `log`. `program` replaces the handler, e.g. with a missing one.
export function createPlayer(
  log: string,
  program?: string,
): {
  extension: string;
  remove(): void;
} {
  const id = `VideoBrowserFixture${randomUUID().replaceAll("-", "")}`;
  const extension = `.vbf${randomUUID().replaceAll("-", "")}`;
  const extensionKey = `HKCU\\Software\\Classes\\${extension}`;
  const playerKey = `HKCU\\Software\\Classes\\${id}`;
  const registry = (args: string[]) =>
    execFileSync("reg.exe", args, { stdio: "pipe" });
  registry(["add", extensionKey, "/ve", "/t", "REG_SZ", "/d", id, "/f"]);
  try {
    const command = program
      ? `"${program}" "%1"`
      : `"${process.execPath}" "${path.resolve("tests/player-observer.cjs")}" "${log}" "%1"`;
    registry([
      "add",
      `${playerKey}\\shell\\open\\command`,
      "/ve",
      "/t",
      "REG_SZ",
      "/d",
      command,
      "/f",
    ]);
  } catch (error) {
    registry(["delete", extensionKey, "/f"]);
    throw error;
  }
  return {
    extension,
    remove() {
      registry(["delete", extensionKey, "/f"]);
      registry(["delete", playerKey, "/f"]);
    },
  };
}
