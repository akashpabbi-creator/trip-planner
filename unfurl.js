// Turns a shared link into { title, description, image, siteName, location, url }.
// Runs entirely in the browser using free public services, so there is no server to pay for:
//   1. Microlink (free, no key, ~50 lookups/day per device) reads Open Graph data, incl. many public
//      Instagram/Facebook posts.
//   2. Fallback: fetch the raw page through a free CORS proxy and read its meta tags ourselves.
// Google Maps links are parsed locally (place name + coordinates), no network needed.

export function extractUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[),.;!?]+$/, "") : null;
}

export function sourceOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\.|^m\./, "");
    if (/instagram\.com$/.test(h)) return "instagram";
    if (/facebook\.com$|fb\.watch$|fb\.com$/.test(h)) return "facebook";
    if (/google\.[a-z.]+$/.test(h) && /\/maps/.test(url)) return "maps";
    if (/maps\.app\.goo\.gl$|goo\.gl$/.test(h)) return "maps";
    if (/youtube\.com$|youtu\.be$/.test(h)) return "youtube";
    if (/tiktok\.com$/.test(h)) return "tiktok";
    return h;
  } catch {
    return "link";
  }
}

function parseGoogleMaps(url) {
  try {
    const u = new URL(url);
    const place = u.pathname.match(/\/place\/([^/]+)/);
    const at = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || u.search.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const q = u.searchParams.get("q") || u.searchParams.get("query");
    const name = place ? decodeURIComponent(place[1].replace(/\+/g, " ")) : q && !/^-?\d/.test(q) ? q : "";
    if (!name && !at) return null;
    return {
      title: name || "Pinned location",
      location: name || `${at[1]},${at[2]}`,
      lat: at ? +at[1] : null,
      lng: at ? +at[2] : null,
      siteName: "Google Maps",
    };
  } catch {
    return null;
  }
}

// Instagram/Facebook titles often look like `Name on Instagram: "caption..."`; tidy them.
function tidy(meta, src) {
  let { title = "", description = "" } = meta;
  if (src === "instagram") {
    const m = title.match(/^(.*?) on Instagram: ["“]?([\s\S]*?)["”]?$/);
    if (m) {
      description = description && !/likes, \d+ comments/.test(description) ? description : m[2];
      title = m[2].split(/[\n.!#📍|]/u)[0].trim().slice(0, 90) || m[1];
    }
    if (/^Instagram$|Login • Instagram/i.test(title)) title = "";
  }
  if (src === "facebook" && /^(Facebook|Log in|Log into Facebook)/i.test(title)) title = "";
  return { ...meta, title: title.trim(), description: description.trim() };
}

// Very light guess at a location from text like "📍 Kyoto, Japan" or "at Café X in Lisbon".
function guessLocation(text) {
  if (!text) return "";
  const pin = text.match(/📍\s*([^\n#|•]{3,60})/);
  if (pin) return pin[1].trim();
  const loc = text.match(/\b(?:Location|Address)\s*[:\-]\s*([^\n#|•]{3,80})/i);
  if (loc) return loc[1].trim();
  return "";
}

async function viaMicrolink(url) {
  const r = await fetch("https://api.microlink.io/?url=" + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("microlink " + r.status);
  const j = await r.json();
  if (j.status !== "success") throw new Error("microlink " + j.status);
  const d = j.data || {};
  return {
    title: d.title || "",
    description: d.description || "",
    image: d.image?.url || d.logo?.url || "",
    siteName: d.publisher || "",
    url: d.url || url,
  };
}

async function viaProxy(url) {
  const r = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(url), { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("proxy " + r.status);
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = (...names) => {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"],meta[name="${n}"]`);
      if (el?.content) return el.content;
    }
    return "";
  };
  let image = meta("og:image", "twitter:image");
  if (image) image = new URL(image, url).href;
  const addr = [meta("place:location:latitude"), meta("place:location:longitude")].filter(Boolean).join(",");
  return {
    title: meta("og:title", "twitter:title") || doc.title || "",
    description: meta("og:description", "twitter:description", "description"),
    image,
    siteName: meta("og:site_name"),
    location: meta("og:locality", "business:contact_data:locality") || addr,
    url,
  };
}

export async function unfurl(url) {
  const src = sourceOf(url);
  const base = { url, source: src, title: "", description: "", image: "", siteName: "", location: "" };
  if (src === "maps") {
    const g = parseGoogleMaps(url);
    if (g) return { ...base, ...g, ok: true };
  }
  for (const fn of [viaMicrolink, viaProxy]) {
    try {
      const m = tidy(await fn(url), src);
      if (m.title || m.image || m.description) {
        const out = { ...base, ...m, url, ok: true };
        out.location ||= guessLocation(m.description) || guessLocation(m.title);
        if (src === "maps" && !out.location) out.location = out.title;
        return out;
      }
    } catch (e) {
      console.warn("unfurl", fn.name, e.message);
    }
  }
  // Nothing readable (common for private or login-walled Instagram/Facebook posts): keep the link anyway.
  let fallbackTitle = "";
  try {
    const u = new URL(url);
    fallbackTitle = { instagram: "Instagram post", facebook: "Facebook post", tiktok: "TikTok video" }[src] || u.hostname.replace(/^www\./, "");
  } catch {}
  return { ...base, title: fallbackTitle, ok: false };
}
