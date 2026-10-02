// A disposable Windows default handler used only by the desktop smoke test.
const { writeFileSync } = require("node:fs");
writeFileSync(process.argv[2], JSON.stringify({ source: process.argv[3] }));
