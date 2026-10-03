// Worker thread that starts thumbnail tool processes. Starting a Windows process
// blocks the starting thread, and the main process's thread also runs the
// window, so starting tools there makes scrolling and clicks stall.
import { spawn } from "node:child_process";
import { parentPort } from "node:worker_threads";

export interface ProcessRequest {
  id: number;
  command: string;
  args: string[];
}
export interface ProcessExit {
  id: number;
  exit: number | null;
  stdout: Uint8Array;
  error: string;
}
/** `pid` once started, so the main thread can stop it; then one `exit`. */
export type ProcessMessage = { id: number; pid: number } | ProcessExit;

/** Larger output stops the process; a thumbnail still is far smaller. */
const outputLimit = 8 * 1024 * 1024;

parentPort?.on("message", ({ id, command, args }: ProcessRequest) => {
  const post = (message: ProcessMessage) => parentPort?.postMessage(message);
  const chunks: Buffer[] = [];
  let size = 0;
  let error = "";
  let finished = false;
  const finish = (exit: number | null) => {
    if (finished) return;
    finished = true;
    post({ id, exit, stdout: Buffer.concat(chunks), error });
  };
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid !== undefined) post({ id, pid: child.pid });
  child.stdout.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > outputLimit) child.kill();
    else chunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    error = (error + chunk.toString()).slice(-2000);
  });
  child.on("error", (failure) => {
    error ||= failure.message;
    finish(null);
  });
  child.on("close", finish);
});
