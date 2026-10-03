const UA = { "User-Agent": "trip-planner-tests/1.0 (github.com/akashpabbi-creator/trip-planner)" };
const t = ["Rome/Vatican", "Rome/North", "Rome/Colosseo", "Rome/Old Rome", "Rome/Trastevere"];
const u = "https://en.wikivoyage.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&origin=*&titles=" + encodeURIComponent(t.join("|"));
const j = await (await fetch(u, { headers: UA })).json();
console.log("error:", JSON.stringify(j.error || null).slice(0, 300), "warnings:", JSON.stringify(j.warnings || null).slice(0, 500), "continue:", JSON.stringify(j.continue || null));
for (const p of j.query?.pages || []) console.log(p.title, p.missing ? "MISSING" : "", (p.revisions?.[0]?.slots?.main?.content || "").length);
