// The card shell: wraps one view in a full HTML page that Claude renders in a sandboxed frame.
// Inlined: the app's design tokens (tokens.css) and icon sprite (icons.svg), so a colour or icon change updates the app and the cards together.
// Not inlined: the MCP Apps client, which the Worker serves at /ui/app.js (named in the card's CSP, no third-party CDN).
import tokens from "../../../tokens.css";
import sprite from "../../../icons.svg";
import shellCss from "./shell.css";
import clientJs from "./shell-client.txt";
import appBundle from "./vendor/ext-apps-1.7.5.txt";

export const APP_PATH = "/ui/app.js";
export const APP_BUNDLE = appBundle;
export const RESOURCE_MIME = "text/html;profile=mcp-app";
export const FONTS_CSS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap";
// Where cards may load things from: only the Worker (the client) and Google Fonts; no network calls of their own (buttons go through the host).
export const csp = (origin) => ({ resourceDomains: [origin, "https://fonts.googleapis.com", "https://fonts.gstatic.com"], connectDomains: [] });

const stripSpriteHeader = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace("<svg ", '<svg class="t-sprite" aria-hidden="true" focusable="false" ');

// view: { title, css?, script } where script is a module-body that calls Trips.view({...}). origin: the Worker's own origin.
export function cardHtml(view, origin) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${view.title.replace(/[<>&]/g, "")}</title>
<link rel="stylesheet" href="${FONTS_CSS}">
<style>${tokens}
${shellCss}
${view.css || ""}</style></head><body>
${stripSpriteHeader(sprite)}
<div id="root"></div>
<script type="module">
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from "${origin}${APP_PATH}";
${clientJs}
${view.script}
</script></body></html>`;
}
