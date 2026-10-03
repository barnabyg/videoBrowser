// Focused checks of the thumbnail work queue; the desktop specs cover its use.
import { test, expect } from "@playwright/test";
import { startQueue } from "../src/queue";

// A job runner whose jobs finish only when the test releases them.
function controlledRunner() {
  const started: string[] = [];
  const finishers = new Map<string, () => void>();
  let running = 0;
  let peak = 0;
  const run = (id: string) => {
    started.push(id);
    peak = Math.max(peak, ++running);
    return new Promise<void>((resolve, reject) => {
      finishers.set(id, () => {
        running--;
        if (id.startsWith("fail")) reject(new Error("job failed"));
        else resolve();
      });
    });
  };
  const finish = async (id: string) => {
    finishers.get(id)?.();
    // Lets the queue observe the settled job and start the next one.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { run, started, finish, peak: () => peak };
}

const entries = (...ids: string[]) =>
  new Map(ids.map((id) => [id, `C:\\videos\\${id}.mp4`]));

test("runs entries in folder order with bounded concurrency", async () => {
  const runner = controlledRunner();
  startQueue(
    entries("a", "b", "c", "d"),
    runner.run,
    2,
    new AbortController().signal,
  );
  expect(runner.started).toEqual(["a", "b"]);
  await runner.finish("b");
  expect(runner.started).toEqual(["a", "b", "c"]);
  await runner.finish("a");
  await runner.finish("c");
  await runner.finish("d");
  expect(runner.started).toEqual(["a", "b", "c", "d"]);
  expect(runner.peak()).toBe(2);
});

test("prioritised entries start next, in the given order, and later priorities replace earlier ones", async () => {
  const runner = controlledRunner();
  const queue = startQueue(
    entries("a", "b", "c", "d", "e", "f"),
    runner.run,
    1,
    new AbortController().signal,
  );
  queue.prioritize(["e", "d"]);
  await runner.finish("a");
  expect(runner.started).toEqual(["a", "e"]);
  // Scrolling away replaces the visible entries; d is no longer preferred.
  queue.prioritize(["f", "unknown", "a"]);
  await runner.finish("e");
  await runner.finish("f");
  expect(runner.started).toEqual(["a", "e", "f", "b"]);
});

test("a failed job does not stop later entries", async () => {
  const runner = controlledRunner();
  startQueue(entries("fail", "b"), runner.run, 1, new AbortController().signal);
  await runner.finish("fail");
  expect(runner.started).toEqual(["fail", "b"]);
});

test("aborting stops new work from starting", async () => {
  const runner = controlledRunner();
  const work = new AbortController();
  const queue = startQueue(entries("a", "b", "c"), runner.run, 1, work.signal);
  work.abort();
  await runner.finish("a");
  queue.prioritize(["c"]);
  expect(runner.started).toEqual(["a"]);
});
