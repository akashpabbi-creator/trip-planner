// dedupe: tells when two saved spots are the same place, so a reel, link or screenshot that names a place already in the
// trip adds its new details to the existing card instead of making a copy. Pure functions, no DOM: the app (addPlaces,
// "Merge duplicates") and the connector (save_ideas) share it.

// "Tiramisù", "The Colosseum, Rome" and "colosseum rome" all reduce to plain lowercase words.
const ARTICLES = new Set(["the", "a", "an", "il", "lo", "la", "le", "l", "el", "los", "las", "al", "de", "du"]);
export function words(s) {
  const w = String(s || "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  return w.length > 1 ? w.filter((x) => !ARTICLES.has(x)) : w;
}
export const norm = (s) => words(s).join(" ");

const near1 = (a, b) => { // one typo apart ("tiramizu" / "tiramisu")
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, miss = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++miss > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return miss + (a.length - i) + (b.length - j) <= 1;
};

export function distM(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every((n) => Number.isFinite(n))) return null;
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

// Same place? Names carry most of the weight; map pins settle the doubtful cases and tell chain branches apart
// ("100 Montaditos" in Rome and in Florence are two places).
export function sameSpot(a, b) {
  if (!a || !b || a.rest || b.rest) return false;
  const wa = words(a.title), wb = words(b.title), na = wa.join(" "), nb = wb.join(" ");
  if (!na || !nb) return false;
  const d = distM(a, b);
  if (d != null && d > 3000) return false;
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) >= 6 && near1(na, nb)) return true;
  const [s, l] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const sub = s.every((x) => l.includes(x)); // "Colosseum" inside "Colosseum Rome"
  if (sub && s.join(" ").length >= 8) return true;
  if (d != null && d < 150) {
    const hit = s.filter((x) => l.includes(x)).length;
    if (sub && s.join(" ").length >= 4) return true;
    if (hit / Math.max(wa.length, wb.length) > 0.5) return true;
  }
  return false;
}

export const findDup = (items, place) => (items || []).find((it) => sameSpot(it, place)) || null;

const SEP = " · ";
const add = (text, extra) => {
  const t = String(text || ""), e = String(extra || "").trim();
  return !e || t.toLowerCase().includes(e.toLowerCase()) ? t : (t ? t + SEP : "") + e;
};

// What a later sighting adds to the card already saved: only fills gaps and adds new tips/links, never overwrites.
// Returns a patch (empty when there is nothing new).
export function mergePatch(have, more) {
  const p = {};
  let notes = have.notes || "";
  for (const piece of String(more.notes || "").split(/\s*·\s*|\n+/)) notes = add(notes, piece);
  const url = more.url && /^https?:\/\//i.test(more.url) ? more.url : "";
  if (url && !have.url) p.url = url;
  else if (url && url !== have.url && !String(have.notes || "").includes(url)) notes = add(notes, "Also: " + url);
  notes = notes.slice(0, 1200);
  if (notes !== (have.notes || "")) p.notes = notes;
  for (const k of ["description", "image", "siteName", "location", "bestTime"]) if (!have[k] && more[k]) p[k] = more[k];
  if (!Number.isFinite(have.lat) && Number.isFinite(more.lat) && Number.isFinite(more.lng)) { p.lat = more.lat; p.lng = more.lng; }
  if (!have.cost && more.cost) p.cost = more.cost;
  if (!have.veg && more.veg) {
    p.veg = more.veg;
    if (more.vegSource) p.vegSource = more.vegSource;
    if (more.vegNote) p.vegNote = more.vegNote;
  }
  if (Array.isArray(more.driveFiles) && more.driveFiles.length) {
    const seen = new Set((have.driveFiles || []).map((f) => JSON.stringify(f)));
    const extra = more.driveFiles.filter((f) => !seen.has(JSON.stringify(f)));
    if (extra.length) p.driveFiles = [...(have.driveFiles || []), ...extra];
  }
  if (more.votes && typeof more.votes === "object") {
    const votes = { ...more.votes, ...(have.votes || {}) };
    if (Object.keys(votes).length !== Object.keys(have.votes || {}).length) p.votes = votes;
  }
  return p;
}

// Spots saved more than once. Within each group the keeper is the one already on a day, else the fullest/oldest card;
// copies on another day are left alone (planned twice on purpose is the person's call). `placed(it)` says whether a card is on a day.
export function dupGroups(items, placed = (it) => !!it.dayId) {
  const list = (items || []).filter((it) => !it.rest && it.title);
  const seen = new Set(), out = [];
  const score = (it) => ["description", "notes", "url", "image", "location", "bestTime"].filter((k) => it[k]).length + (Number.isFinite(it.lat) ? 1 : 0) + (it.veg ? 1 : 0);
  for (const it of list) {
    if (seen.has(it.id)) continue;
    const grp = list.filter((x) => !seen.has(x.id) && (x === it || sameSpot(x, it)));
    grp.forEach((x) => seen.add(x.id));
    if (grp.length < 2) continue;
    const on = grp.filter(placed), off = grp.filter((x) => !placed(x));
    const best = [...off].sort((a, b) => score(b) - score(a) || (a.addedAt || 0) - (b.addedAt || 0));
    const keep = on[0] || best[0];
    const drop = off.filter((x) => x !== keep);
    if (drop.length) out.push({ keep, drop });
  }
  return out;
}

// Folds the copies into the keeper. Returns the keeper's patch.
export function foldPatch(keep, drops) {
  const cur = { ...keep }, patch = {};
  for (const d of drops) {
    const p = mergePatch(cur, d);
    Object.assign(cur, p);
    Object.assign(patch, p);
  }
  return patch;
}

// One short line for a toast about places that were already saved. `rows`: [{ title, merged, day }] (day = 1-based or 0).
export function seenNote(rows) {
  const m = (rows || []).filter((r) => r.merged);
  if (!m.length) return "";
  const where = (r) => (r.day ? `already on Day ${r.day}` : "already in Ideas");
  if (m.length === 1) return `“${m[0].title}” is ${where(m[0])}, so I added the new details to it.`;
  return `${m.length} of these were already saved (${m.slice(0, 3).map((r) => "“" + r.title + "”").join(", ")}${m.length > 3 ? ", …" : ""}), so I added the new details to those.`;
}
