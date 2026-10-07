// Data layer. Two interchangeable backends with the same API:
//  - Firebase (Google sign-in + Firestore realtime) when window.FIREBASE_CONFIG is set
//  - Demo (localStorage + BroadcastChannel) otherwise, so the app can be tried with no setup.

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

export async function createStore() {
  if (window.FIREBASE_CONFIG) return firebaseStore(window.FIREBASE_CONFIG);
  return demoStore();
}

/* ------------------------------------------------------------------ Firebase */
async function firebaseStore(config) {
  const appMod = await import(FB + "firebase-app.js");
  const authMod = await import(FB + "firebase-auth.js");
  const fs = await import(FB + "firebase-firestore.js");

  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = fs.initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  // Local testing only: point at the Firebase emulators.
  if (window.FIREBASE_EMULATORS) {
    authMod.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    fs.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }

  const snapToObj = (d) => ({ id: d.id, ...d.data() });
  const bridgeRef = (token) => fs.doc(db, "bridges", token);

  // Sync indicator: counts writes the server hasn't confirmed yet. Offline writes stay pending until we reconnect.
  let pending = 0;
  const syncCbs = new Set();
  const syncState = () => (!navigator.onLine ? "offline" : pending > 0 ? "saving" : "saved");
  const syncEmit = () => syncCbs.forEach((cb) => cb(syncState()));
  const track = (p) => {
    pending++;
    syncEmit();
    const done = () => { pending--; syncEmit(); };
    p.then(done, done);
    return p;
  };
  // Firestore write promises only resolve on a server ack, so offline they'd hang (pop-ups stay open, follow-up writes never issue).
  // settle() lets callers continue when offline, or after 3s online (flaky signal); the write itself stays queued in the SDK.
  // Errors that land after we settled can't reach the caller, so they go to onWriteError callbacks.
  const errCbs = new Set();
  const settle = (p) =>
    new Promise((res, rej) => {
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(t); res(); } };
      const t = setTimeout(fin, 3000);
      if (!navigator.onLine) fin();
      p.then(fin, (e) => {
        if (!done) { done = true; clearTimeout(t); return rej(e); }
        console.error(e);
        errCbs.forEach((cb) => cb(e));
      });
    });
  const wr = (p, val) => settle(track(p)).then(() => val);
  window.addEventListener("online", syncEmit);
  window.addEventListener("offline", syncEmit);
  fs.onSnapshotsInSync(db, syncEmit);
  const tripRef = (id) => fs.doc(db, "trips", id);
  const sub = (tripId, name) => fs.collection(db, "trips", tripId, name);

  const store = {
    mode: "firebase",
    onSync(cb) {
      syncCbs.add(cb);
      cb(syncState());
      return () => syncCbs.delete(cb);
    },
    onWriteError(cb) {
      errCbs.add(cb);
      return () => errCbs.delete(cb);
    },
    onUser(cb) {
      return authMod.onAuthStateChanged(auth, (u) =>
        cb(u ? { email: u.email.toLowerCase(), name: u.displayName || u.email.split("@")[0], photo: u.photoURL } : null)
      );
    },
    async signIn() {
      const provider = new authMod.GoogleAuthProvider();
      if (window.FIREBASE_EMULATORS && window.TEST_GOOGLE_USER) {
        // Emulator accepts an unsigned Google ID token; lets automated tests sign in without a popup.
        const u = window.TEST_GOOGLE_USER;
        const tok = JSON.stringify({ sub: u.email, email: u.email, email_verified: true, name: u.name });
        return authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(tok));
      }
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
          await authMod.signInWithRedirect(auth, provider);
        } else throw e;
      }
    },
    signOut: () => authMod.signOut(auth),

    watchTrips(email, cb, onErr) {
      const q = fs.query(fs.collection(db, "trips"), fs.where("members", "array-contains", email));
      return fs.onSnapshot(q, (s) => cb(s.docs.map(snapToObj)), onErr);
    },
    createTrip(data) {
      const ref = fs.doc(fs.collection(db, "trips"));
      return wr(fs.setDoc(ref, data), ref.id);
    },
    updateTrip: (id, patch) => fs.updateDoc(tripRef(id), patch),
    async deleteTrip(id) {
      const snap = await fs.getDoc(tripRef(id));
      const token = snap.data()?.bridge?.token;
      if (token) await fs.deleteDoc(bridgeRef(token)).catch(() => {});
      for (const name of ["items", "activity", "presence"]) {
        const s = await fs.getDocs(sub(id, name));
        await Promise.all(s.docs.map((d) => fs.deleteDoc(d.ref)));
      }
      await fs.deleteDoc(tripRef(id));
    },
    // Read-modify-write on the trip doc so two people changing days at once don't overwrite each other.
    // Offline (transactions need the server) it falls back to cache read + updateDoc; two people editing the same list field
    // offline may overwrite each other (last sync wins).
    txTrip(id, fn) {
      const viaCache = async () => {
        const snap = await fs.getDocFromCache(tripRef(id)).catch(() => fs.getDoc(tripRef(id)));
        const patch = fn({ id, ...snap.data() });
        if (patch) await fs.updateDoc(tripRef(id), patch);
      };
      if (!navigator.onLine) return viaCache();
      return fs
        .runTransaction(db, async (tx) => {
          const snap = await tx.get(tripRef(id));
          const patch = fn({ id, ...snap.data() });
          if (patch) tx.update(tripRef(id), patch);
        })
        .catch((e) => (e.code === "unavailable" || e.code === "failed-precondition" || /offline/i.test(e.message || "") ? viaCache() : Promise.reject(e)));
    },
    watchTrip: (id, cb, onErr) => fs.onSnapshot(tripRef(id), (d) => cb(d.exists() ? snapToObj(d) : null), onErr),
    watchItems: (id, cb) => fs.onSnapshot(sub(id, "items"), (s) => cb(s.docs.map(snapToObj))),
    watchActivity: (id, cb) =>
      fs.onSnapshot(fs.query(sub(id, "activity"), fs.orderBy("at", "desc"), fs.limit(200)), (s) => cb(s.docs.map(snapToObj))),
    watchPresence: (id, cb) => fs.onSnapshot(sub(id, "presence"), (s) => cb(s.docs.map(snapToObj))),

    addItem(tripId, data) {
      const ref = fs.doc(sub(tripId, "items"));
      return wr(fs.setDoc(ref, data), ref.id);
    },
    updateItem: (tripId, itemId, patch) => fs.updateDoc(fs.doc(db, "trips", tripId, "items", itemId), patch),
    deleteItem: (tripId, itemId) => fs.deleteDoc(fs.doc(db, "trips", tripId, "items", itemId)),
    batchUpdateItems(tripId, updates) {
      const b = fs.writeBatch(db);
      for (const [itemId, patch] of updates) b.update(fs.doc(db, "trips", tripId, "items", itemId), patch);
      return b.commit();
    },
    // Sets (or, when value is undefined, deletes) one nested field. Emails contain dots, so the path goes in as segments.
    setItemPath: (tripId, itemId, path, value) =>
      fs.updateDoc(fs.doc(db, "trips", tripId, "items", itemId), new fs.FieldPath(...path), value === undefined ? fs.deleteField() : value),
    arrayAdd: (tripId, itemId, field, value) => fs.updateDoc(fs.doc(db, "trips", tripId, "items", itemId), { [field]: fs.arrayUnion(value) }),
    arrayRemove: (tripId, itemId, field, value) => fs.updateDoc(fs.doc(db, "trips", tripId, "items", itemId), { [field]: fs.arrayRemove(value) }),
    log: (tripId, entry) => wr(fs.setDoc(fs.doc(sub(tripId, "activity")), entry)),
    heartbeat: (tripId, me) =>
      fs.setDoc(fs.doc(db, "trips", tripId, "presence", me.email), { email: me.email, name: me.name, at: Date.now() }),

    // Claude link: a doc named by a secret token that a Claude session reads and writes.
    createBridge: (token, data) => fs.setDoc(bridgeRef(token), data),
    updateBridge: (token, patch) => fs.updateDoc(bridgeRef(token), patch),
    deleteBridge: (token) => fs.deleteDoc(bridgeRef(token)),
    watchBridge: (token, cb, onErr) => fs.onSnapshot(bridgeRef(token), (d) => cb(d.exists() ? d.data() : null), onErr),
    // Takes everything in the inbox and empties it, in a transaction so only one phone gets each entry.
    takeInbox: (token) =>
      fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(bridgeRef(token));
        const inbox = snap.exists() ? snap.data().inbox || [] : [];
        if (inbox.length) tx.update(bridgeRef(token), { inbox: [] });
        return inbox;
      }),
  };
  for (const k of ["updateTrip", "updateItem", "deleteItem", "batchUpdateItems", "setItemPath", "arrayAdd", "arrayRemove", "txTrip"]) {
    const fn = store[k];
    store[k] = (...a) => settle(track(fn(...a)));
  }
  return store;
}

/* ---------------------------------------------------------------------- Demo */
function demoStore() {
  const KEY = "tripplanner-demo-v1";
  const chan = "BroadcastChannel" in window ? new BroadcastChannel(KEY) : null;
  const listeners = new Set();
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { trips: {}, items: {}, activity: {}, presence: {}, bridges: {} };
    } catch {
      return { trips: {}, items: {}, activity: {}, presence: {}, bridges: {} };
    }
  };
  let state = load();
  state.bridges ||= {};
  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(state));
    chan?.postMessage("changed");
    emit();
  };
  const emit = () => listeners.forEach((fn) => fn());
  const reload = () => {
    state = load();
    state.bridges ||= {};
    emit();
  };
  chan?.addEventListener("message", reload);
  window.addEventListener("storage", (e) => e.key === KEY && reload());
  const listen = (fn) => {
    const run = () => fn();
    listeners.add(run);
    queueMicrotask(run);
    return () => listeners.delete(run);
  };
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const tripItems = (tripId) => (state.items[tripId] ||= {});

  // Each tab can pretend to be a different person, to try out joint editing.
  const nameKey = "tripplanner-demo-user";
  let user = JSON.parse(sessionStorage.getItem(nameKey) || "null");
  const userCbs = new Set();

  // Tests (and the console) can play the part of Claude writing to the inbox.
  window.__demoBridgePush = (token, entry) => {
    state = load();
    state.bridges ||= {};
    const b = state.bridges[token];
    if (!b) return false;
    (b.inbox ||= []).push(entry);
    b.inboxAt = Date.now();
    save();
    return true;
  };

  return {
    mode: "demo",
    onSync(cb) {
      cb("saved");
      return () => {};
    },
    onUser(cb) {
      userCbs.add(cb);
      queueMicrotask(() => cb(user));
      return () => userCbs.delete(cb);
    },
    async signIn(name) {
      name = (name || "").trim() || "Me";
      user = { email: name.toLowerCase().replace(/[^a-z0-9]+/g, ".") + "@demo", name };
      sessionStorage.setItem(nameKey, JSON.stringify(user));
      userCbs.forEach((cb) => cb(user));
    },
    async signOut() {
      user = null;
      sessionStorage.removeItem(nameKey);
      userCbs.forEach((cb) => cb(null));
    },
    watchTrips(email, cb) {
      return listen(() => cb(Object.values(state.trips).filter((t) => t.members.includes(email))));
    },
    async createTrip(data) {
      const id = uid();
      state.trips[id] = { id, ...data };
      save();
      return id;
    },
    async updateTrip(id, patch) {
      Object.assign(state.trips[id], patch);
      save();
    },
    async deleteTrip(id) {
      const token = state.trips[id]?.bridge?.token;
      if (token) delete state.bridges[token];
      delete state.trips[id];
      delete state.items[id];
      delete state.activity[id];
      save();
    },
    async txTrip(id, fn) {
      state = load();
      const patch = fn(structuredClone(state.trips[id]));
      if (patch) Object.assign(state.trips[id], patch);
      save();
    },
    watchTrip: (id, cb) => listen(() => cb(state.trips[id] ? structuredClone(state.trips[id]) : null)),
    watchItems: (id, cb) => listen(() => cb(Object.values(tripItems(id)).map((x) => structuredClone(x)))),
    watchActivity: (id, cb) => listen(() => cb([...(state.activity[id] || [])].sort((a, b) => b.at - a.at).slice(0, 200))),
    watchPresence: (id, cb) => listen(() => cb(Object.values(state.presence[id] || {}))),
    async addItem(tripId, data) {
      const id = uid();
      tripItems(tripId)[id] = { id, ...data };
      save();
      return id;
    },
    async updateItem(tripId, itemId, patch) {
      Object.assign(tripItems(tripId)[itemId], patch);
      save();
    },
    async deleteItem(tripId, itemId) {
      delete tripItems(tripId)[itemId];
      save();
    },
    async batchUpdateItems(tripId, updates) {
      for (const [itemId, patch] of updates) Object.assign(tripItems(tripId)[itemId], patch);
      save();
    },
    async setItemPath(tripId, itemId, path, value) {
      state = load();
      let o = tripItems(tripId)[itemId];
      for (const k of path.slice(0, -1)) o = o[k] && typeof o[k] === "object" ? o[k] : (o[k] = {});
      const last = path[path.length - 1];
      if (value === undefined) delete o[last];
      else o[last] = structuredClone(value);
      save();
    },
    async arrayAdd(tripId, itemId, field, value) {
      state = load();
      const it = tripItems(tripId)[itemId];
      const arr = (it[field] ||= []);
      if (!arr.some((x) => JSON.stringify(x) === JSON.stringify(value))) arr.push(structuredClone(value));
      save();
    },
    async arrayRemove(tripId, itemId, field, value) {
      state = load();
      const it = tripItems(tripId)[itemId];
      it[field] = (it[field] || []).filter((x) => JSON.stringify(x) !== JSON.stringify(value));
      save();
    },
    async createBridge(token, data) {
      state.bridges[token] = structuredClone(data);
      save();
    },
    async updateBridge(token, patch) {
      state = load();
      state.bridges ||= {};
      if (!state.bridges[token]) throw new Error("No such bridge");
      Object.assign(state.bridges[token], structuredClone(patch));
      save();
    },
    async deleteBridge(token) {
      delete state.bridges[token];
      save();
    },
    watchBridge: (token, cb) => listen(() => cb(state.bridges[token] ? structuredClone(state.bridges[token]) : null)),
    async takeInbox(token) {
      state = load();
      state.bridges ||= {};
      const b = state.bridges[token];
      const inbox = b?.inbox || [];
      if (inbox.length) {
        b.inbox = [];
        save();
      }
      return structuredClone(inbox);
    },
    async log(tripId, entry) {
      (state.activity[tripId] ||= []).push({ id: uid(), ...entry });
      save();
    },
    async heartbeat(tripId, me) {
      state = load();
      (state.presence[tripId] ||= {})[me.email] = { email: me.email, name: me.name, at: Date.now() };
      save();
    },
  };
}
