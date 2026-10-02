import http from "node:http";
import { randomUUID } from "node:crypto";

export const gates = [
  "Formatting",
  "Lint and style",
  "Compiler and types",
  "Static bug analysis",
  "Automated tests",
  "Dependency, secret and package checks",
  "Packaging validation",
];
export function createState() {
  return {
    started: Date.now(),
    stage: "Starting",
    status: "running",
    tests: {},
    output: [],
  };
}
export function updateState(state, event) {
  if (typeof event.stage === "string") state.stage = event.stage;
  if (typeof event.status === "string" && !event.test)
    state.status = event.status;
  if (typeof event.test === "string" && typeof event.status === "string")
    state.tests[event.test] = event.status;
  if (typeof event.output === "string")
    state.output = [...state.output, event.output].slice(-100);
}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Video Browser verification</title><style>body{font:16px Segoe UI,sans-serif;margin:32px;background:#f4f5f7;color:#192332}pre{white-space:pre-wrap;background:white;padding:20px}li{margin:8px 0}</style><h1>Video Browser verification</h1><p id="stage"></p><p id="elapsed"></p><ul id="tests"></ul><pre id="output"></pre><script>async function refresh(){try{const s=await(await fetch('/state')).json();document.getElementById('stage').textContent=s.stage+' — '+s.status;document.getElementById('elapsed').textContent=Math.round((Date.now()-s.started)/1000)+' seconds';const list=document.getElementById('tests');list.replaceChildren();for(const [name,status] of Object.entries(s.tests)){const li=document.createElement('li');li.textContent=name+': '+status;list.append(li)}document.getElementById('output').textContent=s.output.join('')}catch{}setTimeout(refresh,500)}refresh()</script></html>`;

export async function startDashboard({ port = 4179 } = {}) {
  const state = createState();
  const token = randomUUID();
  const server = http.createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    if (request.method === "GET" && request.url === "/") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(html);
    } else if (request.method === "GET" && request.url === "/state") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(state));
    } else if (request.method === "POST" && request.url === `/event/${token}`) {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 16_384) {
          response.writeHead(413).end();
          return;
        }
      }
      try {
        updateState(state, JSON.parse(body));
        response.writeHead(204).end();
      } catch {
        response.writeHead(400).end();
      }
    } else response.writeHead(404).end();
  });
  async function listen(selectedPort) {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(selectedPort, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  }
  try {
    await listen(port);
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    await listen(0);
  }
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return {
    state,
    url,
    events: `${url}/event/${token}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function optionalDashboard(factory = startDashboard) {
  try {
    return await factory();
  } catch (error) {
    console.log(
      `Dashboard unavailable; terminal verification continues: ${error.message}`,
    );
    return undefined;
  }
}
