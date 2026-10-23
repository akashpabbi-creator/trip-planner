// Undo log. Every change the connector makes writes one activity entry in the trip (the same feed the app shows) that also
// carries `undo`: a JSON list of inverse operations. Entries live in the existing `activity` sub-collection, so no rules change.
// Inverse operations (extend this table when a tool needs a new one):
//   { op: "deleteItem", id }                     undoes adding an item
//   { op: "removeListed", field, ids }           undoes appending to a list on the trip doc (tripNotes, checklist)
import { onDay } from "./view.js";

const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
export const newId = rid;

// Writes the feed entry. `by` is the account, `byName` the client (Claude / Gemini) so the feed reads "Claude added ...".
export async function record(c, tripId, text, ops = []) {
  const id = rid();
  await c.fs.create(`trips/${tripId}/activity`, id, {
    at: Date.now(), by: c.email, byName: c.client, text: String(text).slice(0, 300), via: c.client,
    ...(ops.length ? { undo: JSON.stringify(ops), undone: false } : {}),
  });
  return id;
}

export const stamp = (c) => ({ updatedBy: c.email, updatedByName: c.client, updatedAt: Date.now() });

async function run(c, trip, op) {
  if (op.op === "deleteItem") {
    const it = await c.fs.get(`trips/${trip.id}/items/${op.id}`);
    if (!it) return "already gone";
    if (onDay(trip, it) >= 0) throw new Error(`“${it.title}” has since been put on a day, so it was left alone. Ask for it to be removed from that day instead.`);
    await c.fs.remove(`trips/${trip.id}/items/${op.id}`);
    return `removed “${it.title}” from Ideas`;
  }
  if (op.op === "removeListed") {
    let n = 0;
    await c.fs.txTrip(trip.id, (cur) => {
      const list = Array.isArray(cur[op.field]) ? cur[op.field] : [];
      const next = list.filter((x) => !op.ids.includes(x.id));
      n = list.length - next.length;
      return n ? { [op.field]: next, ...stamp(c) } : null;
    });
    return n ? `removed ${n} from ${op.field === "checklist" ? "the Kit list" : "trip notes"}` : "already gone";
  }
  throw new Error("Unknown undo step " + op.op);
}

// Undoes one entry (default: the newest change that can still be undone). Returns what happened.
export async function undo(c, trip, entryId) {
  const rows = await c.fs.activity(trip.id, 100);
  const row = entryId ? rows.find((r) => r.id === entryId) : rows.find((r) => r.undo && !r.undone);
  if (!row) throw new Error(entryId ? "No such change in the recent activity." : "Nothing to undo.");
  if (!row.undo) throw new Error("That change can't be undone from here.");
  if (row.undone) throw new Error("That change was already undone.");
  const said = [];
  for (const op of JSON.parse(row.undo).reverse()) said.push(await run(c, trip, op));
  await c.fs.patch(`trips/${trip.id}/activity/${row.id}`, { undone: true });
  await record(c, trip.id, `undid: ${row.text}`);
  return { undid: row.text, result: said };
}
