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
      ...(search ? { tools: [{ google_search: {} }] } : {}),
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
export async function topPicks(key, trip) {
  const prompt = `You are a travel researcher. For a trip to ${trip.destination}${trip.startDate ? ` starting ${trip.startDate}` : ""} for ${trip.days.length} days, budget ${trip.budget || "not set"} ${trip.currency || ""} for ${trip.members?.length || 2} people.
Use Google Search to find currently top-rated, well-reviewed places (Google Maps / TripAdvisor ratings). Return ONLY a JSON array in a \`\`\`json block, no other text, with 24 items: 7 sightseeing ("sight"), 4 activities ("activity"), 7 restaurants/cafes ("food"), 4 places to stay across price levels ("stay"), 2 nature spots ("nature").
Each item: {"name": string, "category": "sight"|"activity"|"food"|"stay"|"nature", "rating": number (e.g. 4.6), "reviews": number or null, "priceLevel": "$"|"$$"|"$$$"|"$$$$"|null, "approxCost": number in ${trip.currency || "local currency"} for two people or null, "area": neighbourhood, "why": one short sentence on why it's loved, "durationMin": typical visit length in minutes, "address": street address or area for maps}.`;
  const { text } = await call(key, prompt, { search: true });
  const arr = parseJson(text);
  if (!Array.isArray(arr)) throw new Error("Unexpected AI answer");
  return arr.filter((x) => x && x.name).slice(0, 30);
}

// Reviews the plan and returns suggestions the app can apply.
export async function reviewPlan(key, snapshot) {
  const prompt = `You are an expert travel planner reviewing a couple's shared trip plan. Be specific and practical.
Consider: realistic pacing, opening hours and best time of day for each place (e.g. sunsets, markets, dinners in the evening), geographic grouping, the best way to travel each leg (walk, public transport, taxi, train, rental car, flight) for comfort and cost, must-dos from either traveller, balance between what each person added, budget, weather, and anything missing (e.g. meals, rest, check-in times, airport transfers).
Here is the plan as JSON:
${JSON.stringify(snapshot)}

Return JSON: {"summary": "2-3 sentence overall verdict", "suggestions": [{"title": "short imperative", "detail": "1-2 sentences why", "action": {"type": "move"|"add"|"transport"|"time"|"none", "itemId": "id of an existing stop if relevant", "toDay": day number (1-based) for move/add, "mode": "walk"|"transit"|"bus"|"train"|"car"|"rental"|"taxi"|"bike"|"ferry"|"flight" for transport, "minutes": travel minutes for transport, "time": "HH:MM" for time, "place": {"name": "", "category": "sight"|"activity"|"food"|"stay"|"shopping"|"nature"|"transport"|"other", "location": "", "durationMin": 60, "cost": 0} for add}}]}
Give 4 to 10 suggestions, most important first. Use only itemIds that appear in the plan.`;
  const { text } = await call(key, prompt, { json: true });
  const out = parseJson(text);
  return { summary: out.summary || "", suggestions: Array.isArray(out.suggestions) ? out.suggestions : [] };
}
