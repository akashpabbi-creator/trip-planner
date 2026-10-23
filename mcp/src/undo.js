// Undo log. Every change the connector makes writes one activity entry in the trip (the same feed the app shows) that also
// carries `undo`: a JSON list of inverse operations. Entries live in the existing `activity` sub-collection, so no rules change.
// Inverse operations (extend this table when a tool needs a new one):
//   { op: "deleteItem", id, force? }             undoes adding an item (left alone if it has since been put on a day, unless force: used for items the connector put straight on a day)
//   { op: "removeListed", field, ids }           undoes appending to a list on the trip doc (tripNotes, checklist, bookings, extras)
//   { op: "reinsertListed", field, entries }     undoes removing from such a list: entries are { at, item }
//   { op: "patchListed", field, id, before, after }  undoes editing one entry of such a list (guarded like patchItem)
//   { op: "restoreItem", id, data }              undoes deleting an item
//   { op: "patchItem", id, before, after }       undoes edits/moves of an item; left alone if someone changed those fields since
//   { op: "restoreFields", before, after }       undoes edits of plain trip fields or the days list, with the same guard
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

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const stamp = (c) => ({ updatedBy: c.email, updatedByName: c.client, updatedAt: Date.now() });

async function run(c, trip, op) {
  if (op.op === "deleteItem") {
    const it = await c.fs.get(`trips/${trip.id}/items/${op.id}`);
    if (!it) return "already gone";
    if (!op.force && onDay(trip, it) >= 0) throw new Error(`“${it.title}” has since been put on a day, so it was left alone. Ask for it to be removed from that day instead.`);
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
    return n ? `removed ${n} from ${({ checklist: "the Kit list", tripNotes: "trip notes", bookings: "bookings", extras: "the budget extras" })[op.field] || op.field}` : "already gone";
  }
  if (op.op === "reinsertListed") {
    let n = 0;
    await c.fs.txTrip(trip.id, (cur) => {
      const list = Array.isArray(cur[op.field]) ? [...cur[op.field]] : [];
      n = 0;
      for (const e of [...op.entries].sort((a, b) => a.at - b.at)) {
        if (list.some((x) => x.id === e.item.id)) continue;
        list.splice(Math.min(e.at, list.length), 0, e.item);
        n++;
      }
      return n ? { [op.field]: list, ...stamp(c) } : null;
    });
    return n ? `put ${n} back in ${op.field}` : "already there";
  }
  if (op.op === "patchListed") {
    let said = "";
    await c.fs.txTrip(trip.id, (cur) => {
      const list = [...(cur[op.field] || [])];
      const i = list.findIndex((x) => x.id === op.id);
      if (i < 0) throw new Error("That entry has since been removed, so it was left alone.");
      for (const k of Object.keys(op.after)) if (!same(list[i][k], op.after[k])) throw new Error(`“${list[i].title || list[i].text || op.id}” has been changed since (${k}), so it was left alone.`);
      list[i] = { ...list[i], ...op.before };
      said = `restored “${list[i].title || list[i].text}”`;
      return { [op.field]: list, ...stamp(c) };
    });
    return said;
  }
  if (op.op === "restoreItem") {
    if (await c.fs.get(`trips/${trip.id}/items/${op.id}`)) return "already there";
    await c.fs.create(`trips/${trip.id}/items`, op.id, op.data);
    return `put back “${op.data.title}”`;
  }
  if (op.op === "patchItem") {
    const it = await c.fs.get(`trips/${trip.id}/items/${op.id}`);
    if (!it) throw new Error("That place has since been removed, so it was left alone.");
    for (const k of Object.keys(op.after)) if (!same(it[k], op.after[k])) throw new Error(`“${it.title}” has been changed since (${k}), so it was left alone. Ask for the edit you want instead.`);
    await c.fs.patch(`trips/${trip.id}/items/${op.id}`, { ...op.before, ...stamp(c) });
    return `restored “${it.title}”`;
  }
  if (op.op === "restoreFields") {
    let said = "";
    await c.fs.txTrip(trip.id, (cur) => {
      for (const k of Object.keys(op.after)) if (!same(cur[k], op.after[k])) throw new Error(`The trip's ${k} has been changed since, so it was left alone. Ask for the edit you want instead.`);
      said = "restored " + Object.keys(op.before).join(", ");
      return { ...op.before, ...stamp(c) };
    });
    return said;
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
