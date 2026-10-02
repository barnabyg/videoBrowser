import { readFile, readdir } from "node:fs/promises";
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bnpm_[A-Za-z0-9]{36,}\b/,
];
async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) await scan(file);
    else {
      const content = await readFile(file, "utf8");
      if (patterns.some((pattern) => pattern.test(content)))
        throw new Error(`Credential pattern in ${file}`);
    }
  }
}
for (const folder of ["src", "scripts", "tests", ".github"]) await scan(folder);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
for (const [name, version] of Object.entries(pkg.devDependencies)) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`Unpinned dependency: ${name}`);
  if (lock.packages[`node_modules/${name}`]?.version !== version)
    throw new Error(`Lockfile mismatch: ${name}`);
}
console.log(
  "Source credential-pattern scan and exact dependency/lockfile checks passed.",
);
