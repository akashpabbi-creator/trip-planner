// Minimal MCP server over Streamable HTTP (stateless, JSON responses): initialize, ping, tools/list, tools/call.
import { TOOLS, byName } from "./tools.js";
import { session, SignInExpired, NotAiUser } from "./session.js";

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = [
  "Akash and Sanj's shared trip planner. Tools read the live plan; the signed-in account can only see trips it is a member of.",
  "Rules: they are vegetarian (any restaurant is fine if it has vegetarian, vegan or egg options). Never fill empty days unless asked.",
  "Pick the trip by name or destination; if unsure, call list_trips and ask.",
].join(" ");

const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });

async function callTool(params, env, props) {
  const tool = byName[params?.name];
  if (!tool) return { ...text(`Unknown tool "${params?.name}".`), isError: true };
  try {
    const s = await session(env, props.refreshToken);
    return text(await tool.run(params.arguments || {}, s));
  } catch (e) {
    if (e instanceof SignInExpired) return { ...text("The sign-in for this connector has expired. Remove the Trips connector and add it again to sign in."), isError: true };
    if (e instanceof NotAiUser) return { ...text("This account isn't enabled for Claude and Gemini in the trip planner."), isError: true };
    if (e?.status === 403) return { ...text("The trip planner refused this (not a member of that trip, or the rules don't allow it)."), isError: true };
    return { ...text(String(e?.message || e)), isError: true };
  }
}

async function handle(msg, env, props) {
  const { id, method, params } = msg || {};
  if (id === undefined) return null; // notification (e.g. notifications/initialized): nothing to answer
  switch (method) {
    case "initialize": {
      const v = VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0];
      return rpc(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "trips", title: "Trip planner", version: "1.0.0" }, instructions: INSTRUCTIONS });
    }
    case "ping": return rpc(id, {});
    case "tools/list": return rpc(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": return rpc(id, await callTool(params, env, props));
    default: return rpcErr(id, -32601, "Method not found: " + method);
  }
}

export async function handleMcp(request, env, props) {
  if (request.method === "DELETE") return new Response(null, { status: 200 });
  if (request.method !== "POST") return new Response("This endpoint speaks MCP over POST.", { status: 405, headers: { Allow: "POST, DELETE" } });
  let body;
  try { body = await request.json(); } catch { return Response.json(rpcErr(null, -32700, "Parse error"), { status: 400 }); }
  const msgs = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(msgs.map((m) => handle(m, env, props)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? out : out[0]);
}
