// Runs the UI test files in this folder (everything except the real-network checks and the connector Worker tests, which have their own workflows).
// Usage: node tests/run-ui.mjs [shard/of]   e.g. 2/3. A failing file is retried once (browser timing), and the run fails if any file still fails.
import { readdirSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const here = dirname(fileURLToPath(import.meta.url));
const SKIP = /^(real-data|e2e-real|mcp-.*|run-ui|screens|_.*)\.mjs$/;
const all = readdirSync(here).filter((f) => f.endsWith(".mjs") && !SKIP.test(f)).sort();
const [i, n] = (process.argv[2] || "1/1").split("/").map(Number);
const mine = all.filter((_, k) => k % n === i - 1);
const failed = [];
for (const f of mine) {
  let r;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    r = spawnSync("node", [join(here, f)], { encoding: "utf8", timeout: 600000, maxBuffer: 1 << 26 });
    const secs = Math.round((Date.now() - t0) / 1000);
    if (r.status === 0) { console.log(`PASS ${f} (${secs}s)`); break; }
    console.log(`${attempt === 1 ? "RETRY" : "FAIL "} ${f} (${secs}s)\n${(r.stdout || "").split("\n").filter((l) => /FAIL|Error|exception/.test(l)).slice(0, 12).join("\n")}${(r.stderr || "").slice(-600)}`);
  }
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\n${failed.length} test file(s) failed: ${failed.join(", ")}` : `\nAll ${mine.length} test files passed (shard ${i}/${n})`);
process.exit(failed.length ? 1 : 0);
