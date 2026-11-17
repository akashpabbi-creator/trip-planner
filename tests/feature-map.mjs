// Feature map: every data-action that existed before the redesign (tests/feature-map.json) must still be rendered somewhere in the
// app's source AND still have a handler, so a redesign job cannot silently drop a feature. A job that really retires an action
// removes it from feature-map.json in the same PR (and says so), and new actions may be added there.
// Run: node tests/feature-map.mjs   (static check, no browser)
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [...readdirSync(root).filter((f) => f.endsWith(".js") && f !== "config.js"), "index.html"];
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(root, f), "utf8")]));
const rendered = new Set(), handled = new Set();
for (const s of Object.values(src)) {
  for (const m of s.matchAll(/data-action=(?:"([\w-]+)"|([\w-]+))/g)) rendered.add(m[1] || m[2]);
  for (const m of s.matchAll(/case "([\w-]+)"/g)) handled.add(m[1]);
  for (const m of s.matchAll(/\.action\(\s*"([\w-]+)"/g)) handled.add(m[1]);
  for (const m of s.matchAll(/data-action=\\?"?([\w-]+)\\?"?\]/g)) handled.add(m[1]);
}
const baseline = JSON.parse(readFileSync(join(root, "tests", "feature-map.json"), "utf8")).actions;
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + msg); };
const lost = baseline.filter((a) => !rendered.has(a));
const unhandled = baseline.filter((a) => rendered.has(a) && !handled.has(a));
ok(!lost.length, `all ${baseline.length} baseline actions are still rendered` + (lost.length ? ": missing " + lost.join(", ") : ""));
ok(!unhandled.length, "all of them still have a handler" + (unhandled.length ? ": " + unhandled.join(", ") : ""));
const added = [...rendered].filter((a) => !baseline.includes(a));
if (added.length) console.log(`  note ${added.length} action(s) not in the baseline yet (add them to tests/feature-map.json): ${added.join(", ")}`);
console.log(fails ? `\n${fails} failure(s)` : "\nAll feature-map checks passed");
process.exit(fails ? 1 : 0);
