// Schedules thumbnail work for one selected folder: entries the user can see
// first, then the rest in folder order, with a bounded number of running jobs.

export interface ThumbnailQueue {
  /** Prefers these entries, in this order, over the rest; replaces earlier priorities. Unknown or finished ids are ignored. */
  prioritize(ids: readonly string[]): void;
}

/** More priorities than this are ignored; a viewport never shows this many entries. */
const maxPriorities = 500;

/**
 * Starts `run` for each entry (id → source) with at most `concurrency` jobs at a
 * time. A failed job does not stop later entries. Aborting `signal` starts no
 * further jobs and releases the pending entries; running jobs observe `signal`
 * themselves.
 */
export function startQueue(
  entries: ReadonlyMap<string, string>,
  run: (id: string, source: string) => Promise<void>,
  concurrency: number,
  signal: AbortSignal,
): ThumbnailQueue {
  // Insertion order is folder order.
  const pending = new Map(entries);
  let priorities: readonly string[] = [];
  let active = 0;
  signal.addEventListener("abort", () => pending.clear(), { once: true });

  function take(): [string, string] | undefined {
    for (const id of priorities) {
      const source = pending.get(id);
      if (source !== undefined) {
        pending.delete(id);
        return [id, source];
      }
    }
    const first = pending.entries().next();
    if (first.done) return undefined;
    pending.delete(first.value[0]);
    return first.value;
  }

  function fill(): void {
    while (active < concurrency && !signal.aborted) {
      const job = take();
      if (!job) return;
      active++;
      void run(...job)
        .catch(() => undefined)
        .finally(() => {
          active--;
          fill();
        });
    }
  }

  fill();
  return {
    prioritize(ids) {
      priorities = ids.slice(0, maxPriorities);
      fill();
    },
  };
}
