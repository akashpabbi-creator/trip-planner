// connector: the "Trips connector" card (More, Connector). Shows the address to add in Claude or Gemini, lists the apps
// signed in to the connector for this account, and cuts one or all of them. Talks to the Worker's /connections and
// /disconnect with the user's own Firebase sign-in, so an account only ever sees its own connections.
const CSS = `
.cn-url { display: flex; gap: 6px; margin: 8px 0; }
.cn-url input { flex: 1; min-width: 0; font-family: ui-monospace, monospace; font-size: .85rem; }
.cn-list { display: grid; gap: 6px; margin: 8px 0; }
.cn-row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.cn-row small { display: block; }
`;

export function init(ctx) {
  const { S, esc, toast } = ctx;
  document.head.append(Object.assign(document.createElement("style"), { id: "css-connector", textContent: CSS }));
  const origin = () => String(window.MCP_ORIGIN || "").replace(/\/$/, "");

  async function call(path, body) {
    const idToken = await S.store.idToken?.();
    if (!idToken) throw new Error("Sign in again to manage the connector.");
    const r = await fetch(origin() + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, idToken }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || "The connector didn't answer (" + r.status + ").");
    return j;
  }

  function sheet(html) {
    ctx.$form.innerHTML = html;
    ctx.$form.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => ctx.$modal.close()));
    ctx.$form.onsubmit = (e) => { e.preventDefault(); ctx.$modal.close(); };
    if (!ctx.$modal.open) ctx.$modal.showModal();
  }

  function view(list, err) {
    const url = origin() + "/mcp";
    const rows = list == null
      ? `<p class="muted small">${err ? esc(err) : "Checking who is connected…"}</p>`
      : list.length
        ? list.map((c) => `<div class="cn-row"><span>${esc(c.client)}<small class="muted">${c.since ? "since " + esc(new Date(c.since).toISOString().slice(0, 10)) : ""}</small></span><button type="button" class="btn-s danger" data-action="connectorCut" data-id="${esc(c.id)}">Disconnect</button></div>`).join("")
        : `<p class="muted small">Nothing is connected yet.</p>`;
    sheet(`<h3>🔌 Trips connector</h3>
      <p class="small">Add this connector in Claude or Gemini and they can read and change your trips directly, as you. Every change they make shows in Activity with an Undo button.</p>
      <p class="small"><b>Claude:</b> Settings, Connectors, Add custom connector. <b>Gemini:</b> add it as a custom app (MCP). Paste this address:</p>
      <div class="cn-url"><input readonly value="${esc(url)}" aria-label="Connector address" onfocus="this.select()"><button type="button" class="btn-s" data-action="connectorCopy">Copy</button></div>
      <h4>Connected apps</h4>
      <div class="cn-list">${rows}</div>
      ${list?.length > 1 ? `<div class="row"><button type="button" class="danger link" data-action="connectorCut">Disconnect all</button></div>` : ""}
      <div class="m-actions"><button type="button" value="cancel" data-close>Close</button></div>`);
  }

  async function open() {
    if (!S.aiUser) return;
    if (!origin()) return toast("The connector isn't set up yet.");
    view(null);
    try { view((await call("/connections")).connections || []); }
    catch (e) { view(null, e.message); }
  }

  ctx.action("connectorOpen", open);
  ctx.action("connectorCopy", async () => {
    await navigator.clipboard.writeText(origin() + "/mcp");
    toast("Address copied.");
  });
  ctx.action("connectorCut", async (b) => {
    const id = b.dataset.id;
    if (!confirm(id ? "Disconnect this app? It will lose access to your trips." : "Disconnect every app? They will all lose access to your trips.")) return;
    try {
      await call("/disconnect", id ? { id } : {});
      toast("Disconnected.");
    } catch (e) { toast(e.message); }
    open();
  });
}
