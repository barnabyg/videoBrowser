import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  updateState,
  startDashboard,
  optionalDashboard,
  gates,
  finishDashboard,
} from "../scripts/dashboard.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import DashboardReporter from "./dashboard-reporter.mjs";

test("dashboard retains failures, test progress and bounded recent output", () => {
  const state = createState();
  updateState(state, { stage: "Automated tests" });
  updateState(state, { test: "Launch video", status: "failed" });
  for (let i = 0; i < 120; i++) updateState(state, { output: `${i}\n` });
  updateState(state, { status: "failed" });
  assert.equal(state.stage, "Automated tests");
  assert.equal(state.tests["Launch video"], "failed");
  assert.equal(state.status, "failed");
  assert.equal(state.output.length, 100);
  assert.equal(state.output[0], "20\n");
});
test("gate profile preserves required verification order", () => {
  assert.deepEqual(gates, [
    "Formatting",
    "Lint and style",
    "Compiler and types",
    "Static bug analysis",
    "Automated tests",
    "Dependency, secret and package checks",
    "Packaging validation",
  ]);
});
test("concurrent loopback dashboards have isolated state and event endpoints", async () => {
  const first = await startDashboard({ port: 0 });
  const port = Number(new URL(first.url).port);
  const second = await startDashboard({ port });
  try {
    assert.notEqual(first.url, second.url);
    assert.equal((await fetch(first.url)).status, 200);
    assert.equal(
      (await fetch(`${first.url}/event/wrong`, { method: "POST" })).status,
      404,
    );
    assert.equal(
      (
        await fetch(first.events, {
          method: "POST",
          body: JSON.stringify({ test: "Real media", status: "passed" }),
        })
      ).status,
      204,
    );
    assert.equal(
      (await fetch(first.events, { method: "POST", body: "{" })).status,
      400,
    );
    assert.equal(
      (await (await fetch(`${first.url}/state`)).json()).tests["Real media"],
      "passed",
    );
    assert.deepEqual(
      (await (await fetch(`${second.url}/state`)).json()).tests,
      {},
    );
  } finally {
    await first.close();
    await second.close();
  }
});
test("dashboard degradation preserves the terminal verification route", async () => {
  assert.equal(
    await optionalDashboard(() => {
      throw new Error("Port unavailable");
    }),
    undefined,
  );
});
test("runner reporter sends ordered progress and tolerates unavailable endpoints", async () => {
  const dashboard = await startDashboard({ port: 0 });
  const previous = process.env.TEST_DASHBOARD_EVENTS;
  try {
    process.env.TEST_DASHBOARD_EVENTS = dashboard.events;
    const reporter = new DashboardReporter();
    reporter.onTestBegin({ title: "Thumbnail smoke" });
    reporter.onTestEnd({ title: "Thumbnail smoke" }, { status: "passed" });
    await reporter.onEnd();
    assert.equal(dashboard.state.tests["Thumbnail smoke"], "passed");
    await dashboard.close();
    const unavailable = new DashboardReporter();
    unavailable.onTestBegin({ title: "Terminal remains usable" });
    await assert.doesNotReject(unavailable.onEnd());
  } finally {
    if (previous === undefined) delete process.env.TEST_DASHBOARD_EVENTS;
    else process.env.TEST_DASHBOARD_EVENTS = previous;
  }
});

test("an unwritable report keeps the gate result and still closes the dashboard", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "video-browser-report-"),
  );
  const dashboard = await startDashboard({ port: 0 });
  try {
    // Writing a JSON file onto an existing directory deterministically fails.
    await finishDashboard(dashboard, 0, { reportPath: directory, holdMs: 0 });
    assert.equal(dashboard.state.status, "passed");
    await assert.rejects(fetch(`${dashboard.url}/state`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
