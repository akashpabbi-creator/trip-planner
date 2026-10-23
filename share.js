// share: text shared into the app from Gemini (or any app) becomes separate ideas.
// A Gemini answer is mostly a list ("* **Name:** why"); it is split here without any key, shown for a quick check, and saved to Ideas.
// Nothing lands on a day. People with Gemini or Claude can still send the whole text to be read instead.
import { sameName } from "./social.js";

const MAX_IDEAS = 20;
const NOT_A_PLACE = /^(day\s*\d|morning|afternoon|evening|night|breakfast|lunch|dinner|tips?|note|notes|sources?|summary|overview|getting around|where to stay|budget|pro tip|bonus)\b/i;
const CSS = `
.shr-list { margin: 8px 0; display: grid; gap: 6px; max-height: 45vh; overflow: auto; }
.shr-list label { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: start; font-weight: 400; }
.shr-list small { grid-column: 2; }
.shr-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
`;

const plain = (s) => String(s || "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](link) keeps the text
  .replace(/\*\*|__|`|\*(?=\S)|(?<=\S)\*/g, "")
  .replace(/\s+/g, " ").trim();

// Splits a markdown-ish answer into [{ name, why }]. Bold names, bullets, numbered lines and headings count as entries;
// a more indented bullet under an entry is extra detail for it. Intro and closing sentences are skipped.
export function parseSharedList(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^\s*/)[0].replace(/\t/g, "    ").length;
    const m = raw.trim().match(/^(?:#{1,6}\s*|([*\-•–]|\d+[.)])\s+)?(.*)$/);
    const marker = m[1], body = m[2];
    const head = /^#{1,6}\s/.test(raw.trim());
    const bold = body.match(/^\*\*([^*]+)\*\*\s*[:\-–—]?\s*(.*)$/) || body.match(/^__([^_]+)__\s*[:\-–—]?\s*(.*)$/);
    if (!bold && !marker && !head) continue; // plain prose
    if (marker && indent >= 2 && out.length && !bold) { // a sub-bullet is detail for the entry above
      const last = out[out.length - 1];
      last.why = (last.why ? last.why + " " : "") + plain(body);
      continue;
    }
    let name, why;
    if (bold) { name = plain(bold[1]); why = plain(bold[2]); if (!why && /:\s*$/.test(name)) continue; } // "**Food:**" alone is a section title
    else {
      const flat = plain(body);
      const cut = flat.match(/^(.{2,80}?)(?:\s+[–—-]\s+|:\s+)(.*)$/);
      name = cut ? cut[1] : flat;
      why = cut ? cut[2] : "";
    }
    name = name.replace(/^\d+[.)]\s*/, "").replace(/[:：]\s*$/, "").trim();
    if (name.length < 2 || name.length > 80 || NOT_A_PLACE.test(name) || /^https?:/i.test(name)) continue;
    if (/[.!?]$/.test(name) && name.split(" ").length > 8) continue; // a whole sentence is not a name
    if (out.some((x) => sameName(x.name, name))) continue;
    out.push({ name, why: why.slice(0, 300) });
    if (out.length >= MAX_IDEAS) break;
  }
  return out;
}

export function guessCategory(name) {
  const n = String(name || "");
  if (/hotel|homestay|resort|hostel|villa|guest\s?house|lodge|airbnb|\binn\b/i.test(n)) return "stay";
  if (/restaurant|caf[eé]|\bbar\b|bakery|dhaba|thali|shack|eatery|kitchen|brewery|diner|bistro|canteen|biryani|trattoria|osteria|pizzeria|ristorante/i.test(n)) return "food";
  if (/market|bazaar|bazar|mall|\bshop|souk|flea/i.test(n)) return "shopping";
  if (/tour|safari|cruise|diving|rafting|workshop|class\b|festival|paragliding|kayak|show\b/i.test(n)) return "activity";
  if (/beach|waterfall|falls|lake|\bpark\b|trek|\bhill|valley|forest|sanctuary|island|cliff|garden|viewpoint/i.test(n)) return "nature";
  return "sight";
}

export function init(ctx) {
  const { S, esc, toast } = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-share", textContent: CSS }));

  function sheet(html) {
    ctx.$form.innerHTML = html;
    ctx.$form.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => ctx.$modal.close()));
    ctx.$form.onsubmit = (e) => { e.preventDefault(); ctx.$modal.close(); };
    if (!ctx.$modal.open) ctx.$modal.showModal();
  }

  async function save(entries) {
    const have = S.items.map((i) => i.title);
    const fresh = entries.filter((e) => !have.some((h) => sameName(h, e.name)));
    if (!fresh.length) return toast("Those are already saved.");
    const places = fresh.map((e) => ({ title: e.name.slice(0, 120), category: guessCategory(e.name), description: e.why, notes: "" }));
    S.busy = `Adding ${places.length} place${places.length > 1 ? "s" : ""} to Ideas…`;
    ctx.render();
    try {
      await ctx.addPlaces(places, { source: "shared text", autoPlace: false });
      await ctx.log(`saved ${places.length} idea${places.length > 1 ? "s" : ""} from shared text: ${places.map((p) => "“" + p.title + "”").join(", ")}`);
      await ctx.touchTrip();
      toast(`Saved ${places.length} idea${places.length > 1 ? "s" : ""} to Ideas.${fresh.length < entries.length ? " The rest were already there." : ""}`, 5000);
      S.tab = "ideas";
    } catch (e) {
      console.warn("shared text", e);
      toast("Couldn't save those: " + (e.message || e), 6000);
    } finally {
      S.busy = false;
      ctx.render();
    }
  }

  // Entry point from app.js once the trip is chosen and open.
  function shareText(text) {
    text = String(text || "").trim();
    if (!text || !S.trip) return;
    const entries = parseSharedList(text);
    if (entries.length < 2) {
      if (S.aiUser && ctx.openPaste) return ctx.openPaste(text); // free text: let Gemini or Claude find the places
      const title = plain(text.split(/\r?\n/)[0]).slice(0, 80) || "Shared note";
      return ctx.addPlaces([{ title, category: "other", notes: text.slice(0, 1500), noGeo: true }], { source: "shared text", autoPlace: false })
        .then(() => ctx.touchTrip()).then(() => { S.tab = "ideas"; toast("Saved to Ideas as a note.", 4000); ctx.render(); });
    }
    sheet(`<h3>📋 You shared a list</h3>
      <p>Save these to “${esc(S.trip.name)}” as separate ideas? They go to Ideas, not onto a day.</p>
      <div class="shr-list">${entries.map((e, i) => `<label><input type="checkbox" name="shr" value="${i}" checked><span>${esc(e.name)}</span>${e.why ? `<small class="muted">${esc(e.why.slice(0, 140))}</small>` : ""}</label>`).join("")}</div>
      <div class="shr-actions">
        <button type="button" class="primary" data-action="shareAdd">Add to Ideas</button>
        ${S.aiUser && ctx.openPaste ? `<button type="button" data-action="shareRead">Read it with Gemini or Claude</button>` : ""}
        <button type="button" data-close>Not now</button>
      </div>`);
    ctx.shareDraft = { entries, text };
  }

  ctx.shareText = shareText;
  ctx.action("shareAdd", async () => {
    const d = ctx.shareDraft;
    const picked = [...ctx.$form.querySelectorAll("input[name=shr]:checked")].map((c) => d?.entries[Number(c.value)]).filter(Boolean);
    ctx.$modal.close();
    if (!picked.length) return;
    await save(picked);
  });
  ctx.action("shareRead", () => {
    const d = ctx.shareDraft;
    ctx.$modal.close();
    if (d && ctx.openPaste) setTimeout(() => ctx.openPaste(d.text), 100);
  });
}
