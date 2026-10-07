// capture: screenshots to places (the 📷 button and the Android image share target).
// Images are shrunk in the browser, sent to Gemini once, and never stored (not on the trip, not in a cache).
import { call, parseJson, QuotaError, geminiWait } from "./ai.js";

const MAX_IMAGES = 6;
const CSS = `
.cap-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
`;

// Same schema as extractLink (ai.js), but the page is a picture. Search on, so names become real places.
export async function readImage(key, base64s, trip, prefs = "") {
  const prompt = `We are planning a trip to ${trip.destination || "a destination"}. The attached ${base64s.length > 1 ? base64s.length + " images are screenshots" : "image is a screenshot"} (a social post, map, blog, list or message) that mentions places we could visit, eat at or stay at.
${prefs ? "Our preferences:\n" + prefs + "\n" : ""}Read all the text in the image(s), use Google Search to confirm each place, and list every specific place it recommends.
Return ONLY a JSON object in a \`\`\`json block: {"places": [{"name": string, "category": "sight"|"activity"|"food"|"stay"|"shopping"|"nature", "address": street address or area, "durationMin": typical visit minutes, "approxCost": number in ${trip.currency || "INR"} for two people or null, "bestTime": "sunrise"|"morning"|"lunch"|"afternoon"|"sunset"|"evening"|"night"|"", "hours": opening hours and closed days or "", "vegetarian": "yes"|"no"|"" (food only: "yes" if it serves good vegetarian dishes, even if it also serves meat; "no" only if it has little or nothing vegetarian), "why": one sentence on why it's recommended}]}
Only real, named places, at most 10. If the screenshot shows one place, return just that place.`;
  const parts = base64s.map((data) => ({ inline_data: { mime_type: "image/jpeg", data } }));
  const { text } = await call(key, prompt, { search: true, parts });
  const out = parseJson(text);
  return Array.isArray(out.places) ? out.places.filter((x) => x && x.name).slice(0, 10) : [];
}

// Shrinks a picture to at most 1600 px and returns base64 JPEG (no data: prefix).
async function downscale(file) {
  let src, w, h, done = () => {};
  try {
    src = await createImageBitmap(file);
    w = src.width; h = src.height; done = () => src.close?.();
  } catch {
    const url = URL.createObjectURL(file);
    src = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("Couldn't open that picture")); im.src = url; });
    w = src.naturalWidth; h = src.naturalHeight; done = () => URL.revokeObjectURL(url);
  }
  const k = Math.min(1, 1600 / Math.max(w, h));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
  done();
  return cv.toDataURL("image/jpeg", 0.82).split(",")[1];
}

export function init(ctx) {
  const { S, esc, toast } = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-capture", textContent: CSS }));
  let checked = false;

  const canRead = () => !!ctx.aiKey() && !geminiWait();
  // A small sheet in the shared dialog (no Save button: it only explains and offers choices).
  function sheet(html) {
    ctx.$form.innerHTML = html;
    ctx.$form.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => ctx.$modal.close()));
    ctx.$form.onsubmit = (e) => { e.preventDefault(); ctx.$modal.close(); };
    if (!ctx.$modal.open) ctx.$modal.showModal();
  }
  function noGemini() {
    const limit = !!ctx.aiKey();
    sheet(`<h3>📷 Add from a screenshot</h3>
      <p>${limit ? "Gemini's free limit is used up for now, so I can't read pictures right now." : "Reading a screenshot needs a free Gemini key, which you can connect on the Discover tab."}</p>
      <p class="muted small">Your picture is never saved anywhere. It goes to Gemini once to read the place names and is then dropped.</p>
      <div class="cap-actions"><button type="button" class="primary" data-action="bridgeOpen" data-close>Send to Claude instead</button><button type="button" data-close>Close</button></div>`);
  }
  function pick() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    inp.onchange = () => readFiles([...inp.files]);
    inp.click();
  }

  async function readFiles(files) {
    files = files.filter((f) => /^image\//.test(f.type));
    if (!files.length || !S.trip) return;
    if (files.length > MAX_IMAGES) toast(`Reading the first ${MAX_IMAGES} pictures.`);
    files = files.slice(0, MAX_IMAGES);
    const t = S.trip;
    S.busy = `Reading ${files.length > 1 ? files.length + " screenshots" : "the screenshot"}…`;
    ctx.render();
    try {
      const b64 = [];
      for (const f of files) b64.push(await downscale(f));
      const found = await readImage(ctx.aiKey(), b64, t, ctx.profileText(ctx.profileOf(t)));
      const have = new Set(S.items.map((i) => (i.title || "").trim().toLowerCase()));
      const fresh = found.filter((p) => !have.has(String(p.name).trim().toLowerCase()));
      if (!found.length) return toast("I couldn't find any places in that screenshot. Try a clearer one.", 5000);
      if (!fresh.length) return toast("Those places are already saved.");
      const places = fresh.map((p) => ({
        title: String(p.name).slice(0, 140), category: ctx.CATEGORIES[p.category] ? p.category : "sight",
        location: [p.address, t.destination].filter(Boolean).join(", "), durationMin: Number(p.durationMin) || 90,
        cost: Number(p.approxCost) || 0, bestTime: p.bestTime || "",
        notes: [p.hours, p.bestTime && `Best at ${p.bestTime}`].filter(Boolean).join(" · "), description: p.why || "",
        ...(p.category === "food" && ["yes", "some", "no"].includes(p.vegetarian) ? { veg: p.vegetarian === "no" ? "no" : "yes", vegSource: "gemini" } : {}),
      }));
      S.busy = places.length > 1 ? `Adding ${places.length} places to the plan…` : "Adding it to the plan…";
      ctx.render();
      const added = await ctx.addPlaces(places, { source: "screenshot" });
      await ctx.log(places.length > 1 ? `added ${places.length} places from a screenshot: ${places.map((p) => "“" + p.title + "”").join(", ")}` : `added “${places[0].title}” from a screenshot`);
      await ctx.touchTrip();
      const days = added.filter((x) => x.where?.dayIndex != null);
      toast(days.length
        ? `Added ${added.length > 1 ? added.length + " places" : "“" + added[0].title + "”"} from the screenshot (${[...new Set(days.map((x) => "Day " + (x.where.dayIndex + 1)))].sort().join(", ")})${days.length < added.length ? ". The rest are in Ideas" : ""}.`
        : `Saved ${added.length > 1 ? added.length + " places" : "“" + added[0].title + "”"} to Ideas from the screenshot.`, 5000);
      if (S.tab !== "ideas" && S.tab !== "plan") S.tab = days.length ? "plan" : "ideas";
    } catch (e) {
      console.warn("screenshot", e);
      toast(e instanceof QuotaError ? e.message : "Couldn't read that screenshot: " + (e.message || e), 6000);
    } finally {
      S.busy = false;
      ctx.render();
    }
  }

  /* Android share sheet: sw.js parks shared pictures in Cache "share-inbox"; they are read once and removed. */
  async function sharedFiles() {
    const c = await caches.open("share-inbox");
    const out = [];
    for (const k of await c.keys()) {
      const r = await c.match(k);
      const blob = r && (await r.blob());
      if (blob) out.push(new File([blob], "shared.jpg", { type: blob.type || "image/jpeg" }));
    }
    await caches.delete("share-inbox");
    return out;
  }
  async function checkShared() {
    if (checked || !S.trip || !window.caches) return;
    checked = true;
    try {
      if (!(await caches.has("share-inbox"))) return;
      const n = (await (await caches.open("share-inbox")).keys()).length;
      if (!n) return;
      if (!S.aiUser) { await caches.delete("share-inbox"); return; }
      if (!canRead()) { await caches.delete("share-inbox"); return noGemini(); }
      sheet(`<h3>📷 You shared ${n > 1 ? n + " screenshots" : "a screenshot"}</h3>
        <p>Read ${n > 1 ? "them" : "it"} and add the places to “${esc(S.trip.name)}”?</p>
        <p class="muted small">The picture goes to Gemini once and is not saved.</p>
        <div class="cap-actions"><button type="button" class="primary" data-action="captureShared" data-id="read">Read ${n > 1 ? "them" : "it"}</button><button type="button" data-action="captureShared" data-id="skip">Not now</button></div>`);
    } catch (e) { console.warn("shared pictures", e); }
  }

  ctx.slot("addBar", () => !S.aiUser ? "" : `<button class="icon" data-action="capturePick" title="Add places from a screenshot" data-label="From a screenshot" data-sub="Read places off a photo">📷</button>`);
  ctx.action("capturePick", () => !S.aiUser ? null : (canRead() ? pick() : noGemini()));
  ctx.action("captureShared", async (btn, id) => {
    ctx.$modal.close();
    const files = await sharedFiles();
    if (id === "read") await readFiles(files);
  });
  ctx.on("open", () => { checked = false; });
  ctx.on("render", checkShared);
}
