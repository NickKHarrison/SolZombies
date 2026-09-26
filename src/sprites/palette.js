// WO2 3.1 — shared 8-bit palette (Phase 0, FROZEN).
// Case-sensitive character -> CSS colour. '.' is transparent. Art may use only these characters.
export const PALETTE = Object.freeze({
  '.': null,        // transparent
  'k': '#0b0b0d',   // outline black
  'K': '#26262b',   // dark grey
  'm': '#4a4a54',   // gun metal dark
  'M': '#7c7c88',   // gun metal light
  'W': '#b9b9c2',   // steel highlight
  'w': '#f2f2f2',   // white
  'g': '#3f4f26',   // olive dark (fatigues shadow, helmet)
  'G': '#5f7a3a',   // olive
  'L': '#86a050',   // olive highlight
  'o': '#6e4f2a',   // brown dark (boots, straps)
  'O': '#a67c48',   // tan (webbing, backpack)
  't': '#d2a679',   // tan light
  's': '#e5b48f',   // skin
  'S': '#c48a63',   // skin shadow
  'P': '#f0cdb0',   // skin pale (tier 4)
  'h': '#c9a13a',   // hair blond
  'H': '#8a6a1e',   // hair blond shadow
  'e': '#2e6fd6',   // eye blue
  'r': '#8f0f0f',   // blood dark
  'R': '#d92626',   // blood bright
  'y': '#ffd54a',   // yellow (muzzle, tracer)
  'n': '#6cf542',   // ray gun green
  'N': '#2f8f1f',   // ray gun green dark
  'c': '#3ec9ff',   // thundergun cyan
  'C': '#1c6fa8',   // thundergun blue dark
  'p': '#b44dff',   // purple accent
  'x': '#ff00ff',   // placeholder magenta (never ship)
});
