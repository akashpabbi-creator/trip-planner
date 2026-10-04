// Optional AI features using Google's Gemini API (free tier key from https://aistudio.google.com/apikey).
// The key is saved on the trip, which only its members can read.

const MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];
const URL_ = (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

async function call(key, prompt, { json = false, search = false, model } = {}) {
  let lastErr;
  for (const m of model ? [model] : MODELS) {
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, ...(json ? { responseMimeType: "application/json" } : {}) },
      ...(search ? { tools: [{ google_search: {} }, ...(search === "url" ? [{ url_context: {} }] : [])] } : {}),
    };
    try {
      const r = await fetch(URL_(m, key), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) {
        lastErr = new Error(j.error?.message || "Gemini error " + r.status);
        if (r.status === 404) continue; // model name not available, try the next one
        throw lastErr;
      }
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      return { text, model: m };
    } catch (e) {
      lastErr = e;
      if (!/404|not found/i.test(e.message)) throw e;
    }
  }
  throw lastErr;
}
function parseJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const s = m[1].trim();
  const start = s.search(/[[{]/);
  return JSON.parse(s.slice(start));
}

export async function testKey(key) {
  const { model } = await call(key, "Reply with OK.");
  return model;
}

// Top-rated places for the destination, grounded in Google Search so ratings are real.
export async function topPicks(key, trip, prefs = "") {
  const prompt = `You are a travel researcher.${prefs ? `
Our preferences (follow them: restaurants must serve good vegetarian dishes, they do not need to be pure vegetarian; stays that fit them):\n${prefs}\n` : ""} For a trip to ${trip.destination}${trip.startDate ? ` starting ${trip.startDate}` : ""} for ${trip.days.length} days, budget ${trip.budget || "not set"} ${trip.currency || ""} for ${trip.members?.length || 2} people.
Use Google Search to find currently top-rated, well-reviewed places (Google Maps / TripAdvisor ratings). Return ONLY a JSON array in a \`\`\`json block, no other text, with 24 items: 7 sightseeing ("sight"), 4 activities ("activity"), 7 restaurants/cafes ("food"), 4 places to stay across price levels ("stay"), 2 nature spots ("nature").
Each item: {"name": string, "category": "sight"|"activity"|"food"|"stay"|"nature", "rating": number (e.g. 4.6), "reviews": number or null, "priceLevel": "$"|"$$"|"$$$"|"$$$$"|null, "approxCost": number in ${trip.currency || "local currency"} for two people or null, "area": neighbourhood, "why": one short sentence on why it's loved, "durationMin": typical visit length in minutes, "address": street address or area for maps}.`;
  const { text } = await call(key, prompt, { search: true });
  const arr = parseJson(text);
  if (!Array.isArray(arr)) throw new Error("Unexpected AI answer");
  return arr.filter((x) => x && x.name).slice(0, 30);
}

// Reviews the plan and returns suggestions the app can apply.
export async function reviewPlan(key, snapshot, prefs = "") {
  const prompt = `You are an expert travel planner reviewing a couple's shared trip plan. Be specific and practical.${prefs ? `
Their preferences and hard rules (flag anything in the plan that breaks them):\n${prefs}` : ""}
Consider: realistic pacing, opening hours and best time of day for each place (e.g. sunsets, markets, dinners in the evening), geographic grouping, the best way to travel each leg (walk, public transport, taxi, train, rental car, flight) for comfort and cost, must-dos from either traveller, balance between what each person added, budget, weather, and anything missing (e.g. meals, rest, check-in times, airport transfers).
Here is the plan as JSON:
${JSON.stringify(snapshot)}

Return JSON: {"summary": "2-3 sentence overall verdict", "suggestions": [{"title": "short imperative", "detail": "1-2 sentences why", "action": {"type": "move"|"add"|"transport"|"time"|"none", "itemId": "id of an existing stop if relevant", "toDay": day number (1-based) for move/add, "mode": "walk"|"transit"|"bus"|"train"|"car"|"rental"|"taxi"|"bike"|"ferry"|"flight" for transport, "minutes": travel minutes for transport, "time": "HH:MM" for time, "place": {"name": "", "category": "sight"|"activity"|"food"|"stay"|"shopping"|"nature"|"transport"|"other", "location": "", "durationMin": 60, "cost": 0} for add}}]}
Give 4 to 10 suggestions, most important first. Use only itemIds that appear in the plan.`;
  const { text } = await call(key, prompt, { json: true });
  const out = parseJson(text);
  return { summary: out.summary || "", suggestions: Array.isArray(out.suggestions) ? out.suggestions : [] };
}

// Reads a shared link (the page itself, plus the preview we already have) and lists the places in it.
export async function extractLink(key, url, preview, trip, prefs = "") {
  const prompt = `We are planning a trip to ${trip.destination || "a destination"} and saved this link for ideas: ${url}
Preview we could read: ${JSON.stringify({ title: preview.title, caption: preview.description, site: preview.siteName }).slice(0, 2500)}
${prefs ? "Our preferences:\n" + prefs + "\n" : ""}Read the page (or, if it can't be opened, use the preview and Google Search) and list every specific place it recommends that we could visit, eat at or stay at.
Return ONLY a JSON object in a \`\`\`json block: {"places": [{"name": string, "category": "sight"|"activity"|"food"|"stay"|"shopping"|"nature", "address": street address or area, "durationMin": typical visit minutes, "approxCost": number in ${trip.currency || "INR"} for two people or null, "bestTime": "sunrise"|"morning"|"lunch"|"afternoon"|"sunset"|"evening"|"night"|"", "hours": opening hours and closed days or "", "vegetarian": "yes"|"no"|"" (food only: "yes" if it serves good vegetarian dishes, even if it also serves meat; "no" only if it has little or nothing vegetarian), "why": one sentence from the post on why it's recommended}]}
Only real, named places, at most 10. If the link is about one place, return just that place.`;
  const { text } = await call(key, prompt, { search: "url" });
  const out = parseJson(text);
  return Array.isArray(out.places) ? out.places.filter((x) => x && x.name).slice(0, 10) : [];
}

// Checks whether restaurants serve good vegetarian food (they don't have to be pure vegetarian).
export async function checkVeg(key, destination, names) {
  if (!names.length) return [];
  const prompt = `For each restaurant or cafe in ${destination}, use Google Search (menus, Google Maps and Zomato/TripAdvisor reviews) to check whether it serves good vegetarian food. It does NOT need to be a pure vegetarian restaurant: a place that serves meat but has several proper vegetarian dishes counts as "yes". Eggs are fine.
Places: ${JSON.stringify(names)}
Return ONLY a JSON array in a \`\`\`json block, one entry per place in the same order: [{"name": string, "veg": "yes"|"no"|"unknown", "note": "up to 12 words, e.g. the vegetarian dishes to order, or why not"}]. Use "no" only when there is little or nothing vegetarian.`;
  const { text } = await call(key, prompt, { search: true });
  const arr = parseJson(text);
  return Array.isArray(arr) ? arr : [];
}

// Drafts the whole trip day by day from our preferences, grounded in Google Search. The app's rules check it
// (profile.js checkDraft) before it is shown as a proposal.
export async function planTrip(key, trip, prefs, { dates = [], saved = [], guide = [], cities = [], shapes = [], weather = [] } = {}) {
  const n = trip.days.length;
  const prompt = `You are an expert travel planner. Plan a ${n}-day trip to ${trip.destination} for a couple${trip.startDate ? `, day 1 is ${trip.startDate}` : ""}${trip.budget ? `, total budget ${trip.budget} ${trip.currency || ""} for two` : ""}.
Our preferences and hard rules:
${prefs}
Rules for the plan:
- Use Google Search for real, currently open, well-reviewed places. Every place must be a real named place you can give an address for.
- Pace: ${shapes.length ? "the number of sights per day below (cooler days fit more)" : "3 to 4 sights or activities a day in cities, 2 to 3 for beach, hill or nature stays"}. Never fewer than 2 sights a day. Group each day by area to keep travel short, and finish outdoor sights before sunset.
- Every day has lunch (13:00) and dinner (20:00) at places that serve good vegetarian dishes (they do not need to be pure vegetarian). Do NOT add a rest block, the app adds one; keep its window free.
${shapes.length ? shapes.map((s, i) => `- Day ${i + 1}: ${s.sights} sights${weather[i] ? `, ${weather[i].max}°/${weather[i].min}°` : ""}${weather[i]?.sunset ? `, sunset ${weather[i].sunset}` : ""}, rest ${s.rest.time} for ${s.rest.min} min.`).join("\n") : ""}
- Exactly one splurge each: one food splurge dinner, one experience splurge (a tour, guide, ticket or class worth paying for), one stay splurge (in "stays").
- Include one market visit in the trip.
- Never use airports, stations, airlines, bus or ferry terminals, car rental or taxis as stops.
${cities.length > 1 || n >= 5 ? `- If this is a country or region, pick the best 1 city per 2-3 days (e.g. ${cities.join(", ") || "the top cities"}), move between cities at most every 2 days, and set "base" for each day.` : `- Set "base" to the town you sleep in.`}
- Check opening days: ${dates.length ? dates.map((d, i) => `day ${i + 1} is a ${d}`).join(", ") : "avoid places closed on the day you use them"}.
${saved.length ? `- We saved these places; put each on the best day (keep the name exactly): ${JSON.stringify(saved)}` : ""}
${guide.length ? `- Travel guide places you may use: ${JSON.stringify(guide.slice(0, 40))}` : ""}
Return ONLY a JSON object in a \`\`\`json block:
{"summary": "2 sentences on the shape of the trip", "days": [{"day": 1, "base": "city", "theme": "3-5 words", "items": [{"name": string, "category": "sight"|"activity"|"food"|"shopping"|"nature", "time": "HH:MM", "durationMin": number, "address": "street and area", "approxCost": number in ${trip.currency || "INR"} for two or null, "why": "one sentence", "closedDays": "e.g. Mondays" or "", "bookAhead": true|false, "veg": "yes"|"no"|"" (food only), "vegNote": "what to order, up to 10 words", "splurge": "food"|"experience"|"", "market": true|false}]}], "stays": [{"name": string, "base": "city", "address": string, "approxCost": number per night or null, "why": string, "splurge": true|false}]}
Exactly ${n} days.`;
  const { text } = await call(key, prompt, { search: true });
  const out = parseJson(text);
  if (!Array.isArray(out.days)) throw new Error("Unexpected AI answer");
  return out;
}
