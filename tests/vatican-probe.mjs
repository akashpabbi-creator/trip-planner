import { parseListings } from "../discover.js";
const UA = { "User-Agent": "trip-planner-tests/1.0 (github.com/akashpabbi-creator/trip-planner)" };
const get = async (t) => (await (await fetch("https://en.wikivoyage.org/w/api.php?action=parse&prop=wikitext&redirects=1&format=json&page=" + encodeURIComponent(t), { headers: UA })).json()).parse?.wikitext?.["*"] || "";
const rome = await get("Rome");
console.log("DISTRICTS SECTION:", (rome.match(/==\s*Districts\s*==([\s\S]*?)\n==[^=]/i)?.[1] || "none").slice(0, 1500));
const v = await get("Rome/Vatican");
console.log("VATICAN headings:", [...v.matchAll(/^==+[^=].*$/gm)].map((m) => m[0]).join(" | "));
console.log("VATICAN raw see templates:", (v.match(/\{\{\s*(see|listing)[^}]{0,120}/gi) || []).slice(0, 8));
console.log("VATICAN parsed:", parseListings(v).map((l) => l.name + ":" + l.type).slice(0, 30));
