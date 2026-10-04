// Runs the real app in a browser against the real sites (demo mode, no sign-in) and prints the plan it builds.
import { chromium } from "playwright";
const TRIPS = [
  { name: "Italy", destination: "Italy", days: 7, start: "2026-11-10" },
  { name: "Rome", destination: "Rome", days: 3, start: "2026-11-10" },
];
const b = await chromium.launch();
let fails = 0;
for (const T of TRIPS) {
  const p = await b.newPage();
  p.on("pageerror", (e) => console.log("  PAGE ERROR", e.message));
  p.on("console", (m) => /warn|error/.test(m.type()) && console.log("  console." + m.type(), m.text().slice(0, 200)));
  await p.goto("http://127.0.0.1:8765/");
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.fill("#demoName", "Akash");
  await p.click("[data-action=signin]");
  await p.click("[data-action=newTrip]");
  await p.fill("[name=name]", T.name);
  await p.fill("[name=destination]", T.destination);
  await p.fill("[name=numDays]", String(T.days));
  await p.fill("[name=startDate]", T.start).catch(() => {});
  await p.click("#modalForm button[value=ok]");
  // Wait until the sample plan has been written.
  await p.waitForFunction(() => { const db = JSON.parse(localStorage.getItem("tripplanner-demo-v1") || "{}"); const t = Object.values(db.trips || {})[0]; return t && Object.values(db.items?.[t.id] || {}).some((i) => i.dayId); }, null, { timeout: 180000 }).catch(() => console.log("  no plan after 3 minutes"));
  await p.waitForTimeout(8000);
  const db = await p.evaluate(() => JSON.parse(localStorage.getItem("tripplanner-demo-v1")));
  const trip = Object.values(db.trips)[0];
  const items = Object.values(db.items[trip.id] || {});
  console.log(`\n=== App: ${T.name} (${T.days} days from ${T.start}), guide v${trip.guide?.v} with ${trip.guide?.listings?.length} listings`);
  console.log("  weather:", JSON.stringify((trip.weather?.days || []).slice(0, 3)));
  trip.days.forEach((d, i) => {
    const day = items.filter((x) => x.dayId === d.id).sort((a, b) => a.order - b.order);
    const sights = day.filter((x) => ["sight", "activity", "nature", "shopping"].includes(x.category));
    console.log(`  Day ${i + 1}${d.base ? " (" + d.base + ")" : ""}: ` + day.map((x) => `${x.time || "--"} ${x.title} [${x.category}]`).join(" | "));
    const w = trip.weather?.days?.[i] || {};
    const want = w.max != null && w.max < 22 ? 3 : 2;
    if (sights.length < want) { fails++; console.log(`  ❌ day ${i + 1} has ${sights.length} sights (${w.max}°, want ${want}+)`); }
    const rest = day.find((x) => x.rest);
    if (!rest) { fails++; console.log(`  ❌ day ${i + 1} has no rest block`); }
    else if (w.sunset && w.sunset <= "18:30" && rest.time < "16:00") { fails++; console.log(`  ❌ day ${i + 1} rests at ${rest.time} though sunset is ${w.sunset}`); }
    console.log(`    ${w.max}°/${w.min}°, sunrise ${w.sunrise || "?"}, sunset ${w.sunset || "?"}, rest ${rest?.time} for ${rest?.durationMin} min, ${sights.length} sights`);
    const tp = day.filter((x) => /station|termini|airport|terminal|railway|stazione|airline|wizz|bus /i.test(x.title + " " + (x.location || "")));
    if (tp.length) { fails++; console.log(`  ❌ transport on day ${i + 1}: ${tp.map((x) => x.title + " @ " + x.location).join(", ")}`); }
  });
  console.log("  ideas:", items.filter((x) => !x.dayId).map((x) => x.title).join(" | "));
  await p.screenshot({ path: `e2e-${T.name}.png`, fullPage: true });
  await p.close();
}
await b.close();
console.log(fails ? `\n${fails} problem(s)` : "\nApp plans look right");
process.exit(fails ? 1 : 0);
