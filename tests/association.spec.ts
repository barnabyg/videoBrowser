import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { checkAssociation } from "../src/association";

const unique = () => randomUUID().replaceAll("-", "");
const classes = "HKCU\\Software\\Classes";
const registry = (args: string[]) =>
  execFileSync("reg.exe", args, { stdio: "pipe" });

// Registers a disposable extension → ProgID association, runs the check, then
// deletes both keys. `verbs` maps a verb name to its registry values.
async function withAssociation(
  verbs: Record<string, { command?: string; delegate?: boolean }>,
  options: { defaultVerb?: string; missingProgId?: boolean } = {},
) {
  const extension = `.vbf${unique()}`;
  const progId = `VideoBrowserFixture${unique()}`;
  try {
    registry(["add", `${classes}\\${extension}`, "/ve", "/d", progId, "/f"]);
    if (!options.missingProgId) {
      registry(["add", `${classes}\\${progId}`, "/ve", "/d", "Fixture", "/f"]);
      if (options.defaultVerb)
        registry([
          "add",
          `${classes}\\${progId}\\shell`,
          "/ve",
          "/d",
          options.defaultVerb,
          "/f",
        ]);
      for (const [verb, values] of Object.entries(verbs)) {
        const key = `${classes}\\${progId}\\shell\\${verb}\\command`;
        registry(["add", key, "/f"]);
        if (values.command !== undefined)
          registry([
            "add",
            key,
            "/ve",
            "/t",
            "REG_EXPAND_SZ",
            "/d",
            values.command,
            "/f",
          ]);
        if (values.delegate)
          registry([
            "add",
            key,
            "/v",
            "DelegateExecute",
            "/d",
            "{00000000-0000-0000-0000-000000000000}",
            "/f",
          ]);
      }
    }
    return await checkAssociation(extension);
  } finally {
    registry(["delete", `${classes}\\${extension}`, "/f"]);
    if (!options.missingProgId)
      registry(["delete", `${classes}\\${progId}`, "/f"]);
  }
}

test("an extension without a Windows default application is absent", async () => {
  expect(await checkAssociation(`.vbf${unique()}`)).toBe("absent");
});

test("a default application whose program exists is usable", async () => {
  expect(
    await withAssociation({ open: { command: `"${process.execPath}" "%1"` } }),
  ).toBe("ok");
  expect(
    await withAssociation({
      open: { command: "%SystemRoot%\\System32\\notepad.exe %1" },
    }),
  ).toBe("ok");
  expect(
    await withAssociation(
      { play: { command: `"${process.execPath}" "%1"` } },
      { defaultVerb: "play" },
    ),
  ).toBe("ok");
  expect(await withAssociation({ open: { delegate: true } })).toBe("ok");
  expect(
    await withAssociation({ open: { command: "rundll32.exe shell32.dll" } }),
  ).toBe("ok");
});

test("a default application that cannot start is broken", async () => {
  expect(
    await withAssociation({
      open: { command: '"C:\\Missing Player\\player.exe" "%1"' },
    }),
  ).toBe("broken");
  expect(
    await withAssociation({
      open: { command: "C:\\MissingPlayer\\player.exe %1" },
    }),
  ).toBe("broken");
  expect(await withAssociation({}, { missingProgId: true })).toBe("broken");
  expect(await withAssociation({})).toBe("broken");
});
