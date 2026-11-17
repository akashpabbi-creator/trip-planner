// Service-worker checks: (1) every app file at the repo root is listed in SHELL in sw.js (or the app breaks offline),
// (2) when BASE_REF is set (pull requests) and app files changed against it, CACHE in sw.js must have been bumped,
// otherwise open apps never show "New version ready".
// Run: node tests/sw-check.mjs            (SHELL check only)
//      BASE_REF=origin/main node tests/sw-check.mjs
import { readFileSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const sw = readFileSync(join(root, "sw.js"), "utf8");
const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\])/)[1]);
const isApp = (f) => /^[^/]+\.(js|css|svg|webmanifest)$/.test(f) && f !== "sw.js" || f === "index.html" || /^icons\/[^/]+$/.test(f);
const rootFiles = readdirSync(root).filter((f) => isApp(f) && !/^(package|package-lock)\.json$/.test(f));
// connect.html and mcp-config.js belong to the connector page, not the app shell; sw.js itself is never cached.
const NOT_SHELL = new Set(["connect.html", "mcp-config.js"]);
const missing = rootFiles.filter((f) => !NOT_SHELL.has(f) && f !== "index.html" && !shell.includes(f));
ok(!missing.length, "every app file at the root is in SHELL" + (missing.length ? ": missing " + missing.join(", ") : ""));
const gone = shell.filter((f) => f !== "./" && !readdirSync(join(root, dirname(f) === "." ? "" : dirname(f))).includes(f.split("/").pop()));
ok(!gone.length, "every SHELL entry exists" + (gone.length ? ": " + gone.join(", ") : ""));
const base = process.env.BASE_REF;
if (base) {
  const changed = execSync(`git diff --name-only ${base}...HEAD`, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const appChanged = changed.filter((f) => (isApp(f) || f === "index.html") && f !== "config.js");
  const cacheOf = (t) => (t.match(/const CACHE = "([^"]+)"/) || [])[1];
  const before = cacheOf(execSync(`git show ${base}:sw.js`, { cwd: root, encoding: "utf8" }));
  const after = cacheOf(sw);
  if (appChanged.length) ok(before !== after, `app files changed (${appChanged.slice(0, 5).join(", ")}${appChanged.length > 5 ? ", ..." : ""}) so CACHE must be bumped (${before} -> ${after})`);
  else console.log("  ok   no app files changed, CACHE may stay");
} else console.log("  note BASE_REF not set: skipped the CACHE bump check");
console.log(fails ? `\n${fails} failure(s)` : "\nAll service-worker checks passed");
process.exit(fails ? 1 : 0);
