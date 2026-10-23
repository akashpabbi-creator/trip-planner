// Firestore REST client that acts as the signed-in user: every request carries the user's own Firebase ID token,
// so the published firestore.rules (members, aiUsers) decide what the connector may read or write.

export function decode(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields);
  if ("geoPointValue" in v) return v.geoPointValue;
  return null;
}
export const decodeFields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, decode(v)]));
export function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: encodeFields(v) } };
}
export const encodeFields = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)]));

export class FirestoreError extends Error {
  constructor(status, body) {
    super(`Firestore ${status}: ${body?.error?.message || ""}`.trim());
    this.status = status;
  }
}

export function firestoreClient(env, idToken) {
  const root = `${(env.FIRESTORE_HOST || "https://firestore.googleapis.com").replace(/\/$/, "")}/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents`;
  const call = async (method, path, body) => {
    const r = await fetch(root + path, {
      method,
      headers: { Authorization: "Bearer " + idToken, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new FirestoreError(r.status, j);
    return j;
  };
  const toDoc = (d) => ({ id: d.name.split("/").pop(), ...decodeFields(d.fields) });
  // runQuery lives on the parent document: "" for top-level collections, "/trips/ID" for sub-collections.
  const query = async (parent, structuredQuery) => {
    const rows = await call("POST", `${parent}:runQuery`, { structuredQuery });
    return rows.filter((r) => r.document).map((r) => toDoc(r.document));
  };
  const api = {
    async get(path) {
      try { return toDoc(await call("GET", "/" + path)); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    // aiUsers/{email}: the rules let an account read only its own doc, so 404 means "not an AI user".
    exists: async (path) => !!(await api.get(path)),
    tripsFor: (email) => query("", {
      from: [{ collectionId: "trips" }],
      where: { fieldFilter: { field: { fieldPath: "members" }, op: "ARRAY_CONTAINS", value: { stringValue: email } } },
    }),
    items: (tripId) => query(`/trips/${tripId}`, { from: [{ collectionId: "items" }], limit: 2000 }),
    activity: (tripId, limit = 30) => query(`/trips/${tripId}`, {
      from: [{ collectionId: "activity" }], orderBy: [{ field: { fieldPath: "at" }, direction: "DESCENDING" }], limit,
    }),
    // For later jobs (writes): patch named fields of one document.
    async patch(path, data) {
      const mask = Object.keys(data).map((k) => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
      return toDoc(await call("PATCH", `/${path}?${mask}`, { fields: encodeFields(data) }));
    },
  };
  return api;
}
