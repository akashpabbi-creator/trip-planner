// drive: each trip can have a Google Drive folder (picked once with Google's folder picker).
// Screenshots shared into the app are saved there in full size and the idea links to the picture; the connector's
// get_trip returns the folder so Claude files the Trip Sheet PDF in the same place.
// Uses the narrow drive.file permission (only folders you pick and files this app makes), asked for only when a folder is set
// or used. The folder id and link live on the trip doc (not a secret: Drive's own sharing decides who can open it).
// Setting or changing the folder is for AI users, like the other helpers; everyone on the trip sees the link.
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";
const FOLDER = "application/vnd.google-apps.folder";
const CSS = `
.drv-card { margin: 0 0 14px; padding: 12px 14px; background: var(--accent-soft); border-radius: 12px; }
.drv-card h3 { margin: 0 0 4px; font-size: 16px; }
.drv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; }
.drv-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "Goa - December 2026": the destination and the month the trip starts (this month when it has no dates yet).
export function folderName(trip, now = new Date()) {
  const m = String(trip?.startDate || "").match(/^(\d{4})-(\d{2})/);
  const when = m ? `${MONTHS[Number(m[2]) - 1] || ""} ${m[1]}` : `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  return `${String(trip?.destination || trip?.name || "Trip").trim().slice(0, 80)} - ${when}`.replace(/[\\/]/g, "-");
}

let pickerReady = null;
function loadPicker() {
  if (window.google?.picker) return Promise.resolve();
  return (pickerReady ||= new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => window.gapi.load("picker", { callback: ok, onerror: () => no(new Error("Google's folder picker didn't load")) });
    s.onerror = () => { pickerReady = null; no(new Error("Couldn't reach Google's folder picker")); };
    document.head.append(s);
  }));
}

async function pickFolder(token, title) {
  await loadPicker();
  const g = window.google.picker;
  return new Promise((done) => {
    const view = new g.DocsView(g.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER);
    new g.PickerBuilder()
      .addView(view).setOAuthToken(token).setDeveloperKey(window.FIREBASE_CONFIG?.apiKey || "")
      .setAppId(window.FIREBASE_CONFIG?.messagingSenderId || "").setTitle(title)
      .setCallback((d) => {
        if (d.action === g.Action.PICKED) {
          const f = d.docs[0];
          done({ id: f.id, name: f.name, url: f.url || `https://drive.google.com/drive/folders/${f.id}` });
        } else if (d.action === g.Action.CANCEL) done(null);
      })
      .build().setVisible(true);
  });
}

async function api(token, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: "Bearer " + token, ...(init.headers || {}) } });
  if (!r.ok) throw new Error("Google Drive said " + ((await r.json().catch(() => ({}))).error?.message || r.status));
  return r.json();
}
const makeFolder = (token, name, parent) => api(token, API + "?fields=id,name,webViewLink", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
});

// Saves one picture (the original bytes) in the folder.
export async function uploadFile(token, folderId, file, name) {
  const b = "tp" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: ${file.type || "image/jpeg"}\r\n\r\n`, file, `\r\n--${b}--`]);
  const f = await api(token, UPLOAD, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body });
  return { id: f.id, name: f.name || name, url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` };
}

export function init(ctx) {
  const { S, esc, toast } = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-drive", textContent: CSS }));
  let busy = false;

  const folder = () => S.trip?.driveFolder || null;
  const token = () => S.store.driveToken();
  const ext = (f) => ({ "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif" })[f.type] || "jpg";

  function sheet(html) {
    ctx.$form.innerHTML = html;
    ctx.$form.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => ctx.$modal.close()));
    ctx.$form.onsubmit = (e) => { e.preventDefault(); ctx.$modal.close(); };
    if (!ctx.$modal.open) ctx.$modal.showModal();
  }
  async function saveFolder(f) {
    const prev = folder();
    await S.store.updateTrip(S.tripId, { driveFolder: f ? { ...f, by: S.me.email } : null, ...ctx.stampMe() });
    ctx.log(f ? `${prev ? "changed" : "set"} the trip’s Google Drive folder to “${f.name}”` : "removed the trip’s Google Drive folder");
    ctx.touchTrip?.();
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); }
    catch (e) {
      console.warn("drive", e);
      const gone = e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request";
      if (!gone) toast("Google Drive: " + (e.message || e), 6000);
    } finally { busy = false; ctx.render(); }
  }

  // Both ways need the picker, which can't sit under the dialog: close it first.
  function choose(make) {
    ctx.$modal.close();
    // The Google sign-in popup must open from the tap itself, so the token is asked for before anything else.
    return run(async () => {
      const tk = await token();
      const picked = await pickFolder(tk, make ? "Pick the folder to create this trip's folder in" : "Pick the trip's folder");
      if (!picked) return;
      if (!make) { await saveFolder(picked); return toast(`Trip folder set to “${picked.name}”.`); }
      const made = await makeFolder(tk, folderName(S.trip), picked.id);
      await saveFolder({ id: made.id, name: `${picked.name}/${made.name || folderName(S.trip)}`, url: made.webViewLink || `https://drive.google.com/drive/folders/${made.id}` });
      toast(`Created “${folderName(S.trip)}” in “${picked.name}”.`);
    });
  }

  function setup() {
    if (!S.aiUser) return;
    sheet(`<h3>📁 Trip folder in Google Drive</h3>
      <p>Pick where this trip's screenshots and Trip Sheet PDF are kept. Google will ask once to let this app use the folders you pick (nothing else in your Drive).</p>
      <p class="muted small">Tip: pick “Travel - Sanj_Akash” to create <b>${esc(folderName(S.trip))}</b> inside it.</p>
      <div class="drv-actions">
        <button type="button" class="primary" data-action="driveMake">Create “${esc(folderName(S.trip))}” in a folder I pick</button>
        <button type="button" data-action="drivePick">Use a folder I pick</button>
        <button type="button" data-close>Not now</button>
      </div>`);
  }

  function section() {
    const f = folder();
    if (!f && !S.aiUser) return "";
    return `<section class="drv-card" id="drive-folder">
      <h3>📁 Trip folder</h3>
      ${f
        ? `<div>${ctx.safeUrl(f.url) ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)} ↗</a>` : esc(f.name)}</div>
           <p class="muted small">Screenshots shared into the app are saved here, and Claude files the Trip Sheet PDF here.</p>
           ${S.aiUser ? `<div class="drv-row"><button class="btn-s" data-action="driveSetup">Change</button><button class="btn-s" data-action="driveClear">Remove</button></div>` : ""}`
        : `<p class="muted small">No folder yet. Pick one in Google Drive and screenshots you share here are kept in it, along with the final Trip Sheet PDF.</p>
           <div class="drv-row"><button class="btn-s primary" data-action="driveSetup">Choose a Drive folder</button></div>`}
    </section>`;
  }

  // Used by capture.js. ready(): this trip has a folder. save(files): resolves to the saved pictures, [] when Drive can't be used.
  // warm() starts the Google sign-in; call it straight from a tap so the popup isn't blocked.
  ctx.drive = {
    ready: () => !!S.aiUser && !!folder()?.id,
    warm() {
      if (!this.ready()) return Promise.resolve(null);
      return token().catch((e) => { console.warn("drive token", e); return null; });
    },
    async save(files, tokenPromise) {
      const f = folder();
      if (!this.ready()) return [];
      try {
        const tk = await (tokenPromise || token());
        if (!tk) throw new Error("not connected");
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
        const out = [];
        for (let i = 0; i < files.length; i++) out.push(await uploadFile(tk, f.id, files[i], `${S.trip.name} screenshot ${stamp}${files.length > 1 ? " " + (i + 1) : ""}.${ext(files[i])}`));
        return out;
      } catch (e) {
        console.warn("drive save", e);
        toast("Couldn't save the picture to Google Drive (" + (e.message || e) + "). The places were still added.", 6000);
        return [];
      }
    },
  };

  // Idea cards: a link to the saved screenshot(s).
  ctx.slot("card", (it) => {
    const list = Array.isArray(it.driveFiles) ? it.driveFiles.filter((x) => ctx.safeUrl(x?.url)) : [];
    return list.length ? `<a class="btn-s" href="${esc(list[0].url)}" target="_blank" rel="noopener" title="Open the screenshot in Google Drive">📎 Screenshot${list.length > 1 ? ` (+${list.length - 1})` : ""}</a>` : "";
  });
  ctx.slot("kitTop", section);
  ctx.action("driveSetup", setup);
  ctx.action("driveMake", () => choose(true));
  ctx.action("drivePick", () => choose(false));
  ctx.action("driveClear", () => run(async () => { await saveFolder(null); toast("Trip folder removed. The files stay in Drive."); }));
}
