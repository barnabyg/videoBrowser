// Replaces a file whole: the contents go to a temporary file that is renamed
// into place, so an interrupted write leaves the previous file.
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// Windows refuses the rename while another program, such as a virus scanner
// or the search indexer, briefly holds the target open without delete sharing.
const heldOpen = new Set(["EPERM", "EBUSY"]);
/** Waits between rename attempts, about three seconds in all. */
const retryDelaysMs = [10, 20, 40, 80, 160, 320, 640, 640, 640, 640];

export async function replaceFile(
  file: string,
  data: string | Buffer,
): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, file);
      return;
    } catch (error) {
      const wait = retryDelaysMs[attempt];
      if (
        wait === undefined ||
        !heldOpen.has((error as { code?: string }).code ?? "")
      ) {
        await rm(temporary, { force: true });
        throw error;
      }
      await delay(wait);
    }
  }
}
