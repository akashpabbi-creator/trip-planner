// "Open in app" deep links (redesign foundation): <app>/#trip=TRIPID&tab=TAB&day=N. day is 1-based and only meaningful on the plan tab.
export const TABS = ["plan", "ideas", "map", "kit", "discover", "smart", "budget", "itinerary", "changes"];

export function appBase(env) {
  const origin = (env.ALLOWED_ORIGIN || "https://akashpabbi-creator.github.io").replace(/\/$/, "");
  try { return new URL(env.CONNECT_URL).href.replace(/connect\.html.*$/, ""); } catch { return origin + "/trip-planner/"; }
}

export function deepLink(env, { trip, tab = "plan", day } = {}) {
  const p = [];
  if (trip) p.push("trip=" + encodeURIComponent(trip));
  if (trip && TABS.includes(tab)) p.push("tab=" + tab);
  if (tab === "plan" && Number.isInteger(day) && day >= 1) p.push("day=" + day);
  return appBase(env) + (p.length ? "#" + p.join("&") : "");
}
