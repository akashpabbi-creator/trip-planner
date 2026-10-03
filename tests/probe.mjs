// Diagnostics for the real-data check: raw responses from the sites the app depends on.
const UA = { "User-Agent": "trip-planner-tests/1.0 (github.com/akashpabbi-creator/trip-planner)" };
const show = async (label, url, opts = {}) => {
  try {
    const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    console.log(`--- ${label}: ${r.status} ${r.headers.get("access-control-allow-origin") || "(no CORS header)"} len=${t.length}\n${t.slice(0, 400).replace(/\n/g, " ")}`);
    return t;
  } catch (e) { console.log(`--- ${label}: ERROR ${e.message}`); }
};
const WV = "https://en.wikivoyage.org/w/api.php?action=parse&prop=wikitext&redirects=1&format=json&origin=*&page=";
const rome = await show("WV Rome", WV + "Rome");
if (rome) { try { const j = JSON.parse(rome); const w = j.parse?.wikitext?.["*"] || ""; console.log("Rome links with /:", [...new Set([...w.matchAll(/\[\[([^\]|#]+\/[^\]|#]+)/g)].map((x) => x[1]))].slice(0, 20)); console.log("Rome listings:", (w.match(/\{\{\s*(see|do|eat|listing)\s*\|/gi) || []).length); } catch (e) { console.log("parse err", e.message); } }
await show("WV Goa", WV + "Goa");
await show("WV Kyoto", WV + "Kyoto");
// City fame signals for Italy's Cities list
const cities = ["Rome", "Bologna", "Florence", "Genoa", "Milan", "Naples", "Palermo", "Turin", "Venice"];
for (const c of cities) {
  await new Promise((r) => setTimeout(r, 1500));
  const pv = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikivoyage/all-access/user/${c}/monthly/20250101/20251231`, { headers: UA }).then((r) => r.json()).catch(() => null);
  const views = (pv?.items || []).reduce((s, i) => s + i.views, 0);
  const pw = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${c}/monthly/20250101/20251231`, { headers: UA }).then((r) => r.json()).catch(() => null);
  console.log(`fame ${c}: wikivoyage views ${views}, wikipedia views ${(pw?.items || []).reduce((s, i) => s + i.views, 0)}`);
}
const L = "https://luggageandlife.com/where-to-eat-in-rome/";
const WP = "https://luggageandlife.com/wp-json/wp/v2/posts?slug=where-to-eat-in-rome&_fields=title,content";
for (const [n, f] of [["allorigins raw", (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u)], ["allorigins get", (u) => "https://api.allorigins.win/get?url=" + encodeURIComponent(u)], ["codetabs", (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u)], ["corsproxy.io", (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u)], ["cors.lol", (u) => "https://api.cors.lol/?url=" + encodeURIComponent(u)]]) {
  await show(n + " page", f(L), { headers: { Origin: "https://akashpabbi-creator.github.io" } });
  await show(n + " wp-json", f(WP), { headers: { Origin: "https://akashpabbi-creator.github.io" } });
}
