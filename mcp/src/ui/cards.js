// Card registry. A view is one ui:// resource; a tool opts in by name. Job 1 ships the plumbing and one small "status" card on
// whoami so the whole path (tools/list link, resources/read, structuredContent, Open in app) is exercised end to end.
//
// How a card job plugs in (Jobs 2-4):
//   1. Create src/ui/<name>-card.js exporting { title, css, script } (script is a module body that calls Trips.view({ render, after, onUndo })).
//   2. Register it in VIEWS below (uri -> view) and list the tools that show it in TOOL_CARDS (tool name -> { uri, structure? }).
//      structure(result, args, c, env) may reshape the tool's JSON result into structuredContent; add tripId and appUrl (deepLink) there.
//   3. A tool without an entry here is untouched: same text answer, no card. The text `content` is never changed.
import { deepLink } from "./links.js";
import status from "./status-card.js";
import overview from "./overview-card.js";
import receiptCard from "./receipt-card.js";
import { receipt, checkPlan, tripCard, tripList, RECEIPT_TOOLS } from "./receipts.js";

export const VIEWS = {
  "ui://trips/status": status,
  "ui://trips/overview": overview,
  "ui://trips/receipt": receiptCard,
};

export const TOOL_CARDS = {
  whoami: { uri: "ui://trips/status", structure: (r, _a, _c, env) => ({ ...r, appUrl: deepLink(env, {}) }) },
  // Job 4: trip overview, change receipts (Undo + rule warnings) and the plan check.
  list_trips: { uri: "ui://trips/overview", structure: tripList },
  get_trip: { uri: "ui://trips/overview", structure: tripCard },
  check_plan: { uri: "ui://trips/receipt", structure: checkPlan },
  ...Object.fromEntries(RECEIPT_TOOLS.map((t) => [t, { uri: "ui://trips/receipt", structure: receipt(t) }])),
};

// App-only helper tools (_meta.ui.visibility ["app"]): callable from a card, hidden from the model by hosts that honour it.
// A helper is { name, description, inputSchema, run(args, c) } like any tool; card jobs add theirs here.
export const APP_TOOLS = [];
