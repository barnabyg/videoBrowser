// Checks the Windows default application for a file extension before launch.
// ShellExecute reports success when no application is associated (Windows shows
// its own "Open with" prompt instead), so launch errors need this pre-check.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type Association = "ok" | "absent" | "broken";

const reg = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "reg.exe",
);

// Resolves with reg.exe output, or undefined when the key or value is missing.
function query(args: string[]): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    execFile(
      reg,
      ["query", ...args],
      { windowsHide: true, timeout: 5_000 },
      (error, stdout) => {
        if (!error) resolve(stdout);
        else if (error.code === 1) resolve(undefined);
        else reject(error);
      },
    );
  });
}

// Parses a reg.exe string value line into its name and data.
function valueLine(line: string): [string, string] | undefined {
  const match = /^\s{4}(.+?)\s{4}REG_(?:SZ|EXPAND_SZ)\s{4}(.*)$/.exec(line);
  return match?.[1] && match[2] !== undefined
    ? [match[1], match[2]]
    : undefined;
}

function value(output: string | undefined, name: string): string | undefined {
  for (const line of output?.split(/\r?\n/) ?? []) {
    const parsed = valueLine(line);
    if (parsed?.[0] === name && parsed[1]) return parsed[1];
  }
  return undefined;
}

async function progId(extension: string): Promise<string | undefined> {
  const choices = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${extension}`;
  return (
    value(
      await query([`${choices}\\UserChoiceLatest\\ProgId`, "/v", "ProgId"]),
      "ProgId",
    ) ??
    value(await query([`${choices}\\UserChoice`, "/v", "ProgId"]), "ProgId") ??
    value(await query([`HKCR\\${extension}`, "/ve"]), "(Default)")
  );
}

// The program a shell command starts, or undefined when it is resolved by
// Windows (a bare name on PATH or App Paths) or cannot be read reliably.
function program(command: string): string | undefined {
  const trimmed = command.trim();
  const quoted = /^"([^"]+)"/.exec(trimmed);
  const exe = quoted?.[1] ?? /^(.+?\.exe)\b/i.exec(trimmed)?.[1];
  const raw = exe ?? trimmed.split(/\s/)[0] ?? "";
  const expanded = raw.replace(
    /%([^%]+)%/g,
    (match, name: string) => process.env[name] ?? match,
  );
  // reg.exe output uses the console code page, so non-ASCII paths may be garbled.
  if (/[^\x20-\x7e]|%/.test(expanded) || !path.win32.isAbsolute(expanded))
    return undefined;
  return expanded;
}

// Whether the ProgID has a handler Windows can start: a packaged application,
// a DelegateExecute handler, or a verb command whose program exists. Unclear
// registrations count as usable so the launch is still attempted.
async function usable(id: string): Promise<boolean> {
  const output = await query([`HKCR\\${id}`, "/s"]);
  if (output === undefined) return false;
  let key = "";
  const commands = new Map<string, Map<string, string>>();
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("HKEY_")) {
      key = line.slice(line.indexOf("\\") + 1 + id.length).toLowerCase();
      if (key === "\\application") return true;
      if (/^\\shell\\[^\\]+\\command$/.test(key)) commands.set(key, new Map());
      continue;
    }
    const parsed = valueLine(line);
    if (parsed) commands.get(key)?.set(...parsed);
  }
  for (const values of commands.values()) {
    if (values.has("DelegateExecute")) return true;
    const command = values.get("(Default)");
    if (!command) continue;
    const exe = program(command);
    if (!exe || existsSync(exe)) return true;
  }
  return false;
}

export async function checkAssociation(
  extension: string,
): Promise<Association> {
  const id = await progId(extension);
  if (!id) return "absent";
  return (await usable(id)) ? "ok" : "broken";
}
