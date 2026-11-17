// Icon helper for the shared sprite (icons.svg, 24x24 line icons, stroke currentColor 1.8, round caps).
// ic("pin") returns the markup; legacy strings in the app embed the same markup directly.
export const ic = (name, cls = "") => `<svg class="i${cls ? " " + cls : ""}" aria-hidden="true" focusable="false"><use href="icons.svg#${name}"/></svg>`;

// Weather codes are stored as icon names ("sun-cloud"); trips saved before the icon sprite hold an emoji, which still maps over.
const WX_EMOJI = { "\u2600": "sun", "\u{1F324}": "sun-cloud", "\u2601": "cloud", "\u{1F32B}": "fog", "\u{1F327}": "rain", "\u{1F326}": "rain", "\u{1F328}": "snow", "\u26C8": "storm" };
export const wxIcon = (v) => {
  const s = String(v || "").replace(/\uFE0F/g, "");
  if (/^[a-z-]+$/.test(s)) return ic(s);
  return WX_EMOJI[s] ? ic(WX_EMOJI[s]) : "";
};
