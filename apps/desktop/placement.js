// Where the drawer sits: the middle of one edge (top, right, bottom or left) of one screen.
// Saved in config.json as `desktop.drawer`: `{ edge, display }`, where `display` is "primary" (follows
// the main screen) or `{ id, label }`. Until the user picks a screen, the drawer uses the outermost
// screen on that edge, so the pointer stops at the notch.

import { execFile } from "node:child_process";
import { screen } from "electron";
import { readConfig, updateConfig } from "./config.js";

export const EDGES = ["top", "right", "bottom", "left"];
const DEFAULT_EDGE = "right";

// Notch and panel on a left or right edge; on the top and bottom edges the notch lies flat.
const NOTCH = { width: 26, height: 84 };
const PANEL = { width: 360, height: 520 };
// Transparent room around the panel for the open animation's overshoot and the shadow.
const MARGIN = 40;
// Room on each side of a MacBook camera notch for the status dot and the count.
const CAMERA_WING = 30;

/** Display id → camera notch size, macOS only. Electron doesn't report it. */
let cameraNotches = new Map();

const CAMERA_SCRIPT = `
ObjC.import("AppKit");
const out = [];
const screens = $.NSScreen.screens;
for (let i = 0; i < screens.count; i++) {
  const s = screens.objectAtIndex(i);
  const top = s.safeAreaInsets.top;
  if (!(top > 0)) continue;
  const width = s.frame.size.width - s.auxiliaryTopLeftArea.size.width - s.auxiliaryTopRightArea.size.width;
  out.push({ id: Number(ObjC.unwrap(s.deviceDescription.objectForKey("NSScreenNumber"))), width, height: top });
}
JSON.stringify(out);
`;

/** macOS: read the camera notch of each screen (NSScreen.safeAreaInsets). */
export function loadCameraNotches() {
  if (process.platform !== "darwin") return Promise.resolve();
  return new Promise((resolve) => {
    execFile("osascript", ["-l", "JavaScript", "-e", CAMERA_SCRIPT], { timeout: 5000 }, (err, stdout) => {
      try {
        if (!err) cameraNotches = new Map(JSON.parse(stdout).map((n) => [n.id, { width: n.width, height: n.height }]));
      } catch {
        // Older macOS has no safeAreaInsets: no camera notches.
      }
      resolve();
    });
  });
}

function readPlacement() {
  const saved = readConfig().desktop?.drawer ?? {};
  return { edge: EDGES.includes(saved.edge) ? saved.edge : DEFAULT_EDGE, display: saved.display };
}

export function savePlacement({ edge, displayId }) {
  if (!EDGES.includes(edge)) throw new Error(`Unknown edge: ${edge}`);
  const d = screen.getAllDisplays().find((x) => x.id === displayId);
  if (!d) throw new Error("That screen is not connected.");
  const display = d.id === screen.getPrimaryDisplay().id ? "primary" : { id: d.id, label: d.label };
  const config = readConfig();
  updateConfig({ desktop: { ...config.desktop, drawer: { edge, display } } });
}

function chosenDisplay({ edge, display }) {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  if (display === "primary") return primary;
  if (display) {
    return all.find((d) => d.id === display.id) ?? all.find((d) => display.label && d.label === display.label) ?? primary;
  }
  const outer = {
    right: (d) => d.bounds.x + d.bounds.width,
    left: (d) => -d.bounds.x,
    bottom: (d) => d.bounds.y + d.bounds.height,
    top: (d) => -d.bounds.y,
  }[edge];
  return all.reduce((a, b) => (outer(b) > outer(a) ? b : a), primary);
}

/** A `size` rectangle flush with `edge` of `area`, centred along it. */
function edgeRect(area, edge, { width, height }) {
  const x = {
    left: area.x,
    right: area.x + area.width - width,
    top: area.x + (area.width - width) / 2,
    bottom: area.x + (area.width - width) / 2,
  }[edge];
  const y = {
    top: area.y,
    bottom: area.y + area.height - height,
    left: area.y + (area.height - height) / 2,
    right: area.y + (area.height - height) / 2,
  }[edge];
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/** Window bounds and the notch and panel rectangles in screen coordinates, plus sizes for the page. */
export function layout() {
  const placement = readPlacement();
  const { edge } = placement;
  const display = chosenDisplay(placement);
  const vertical = edge === "left" || edge === "right";
  const camera = edge === "top" ? cameraNotches.get(display.id) : undefined;
  // macOS top edge: cover the menu bar, like the camera notch does. Elsewhere keep clear of the Dock
  // or the taskbar.
  const area = edge === "top" && process.platform === "darwin" ? display.bounds : display.workArea;
  const notch = camera
    ? { width: camera.width + CAMERA_WING * 2, height: camera.height }
    : vertical
      ? NOTCH
      : { width: NOTCH.height, height: NOTCH.width };
  // Under a camera notch the panel starts with a strip the camera hides.
  const inset = camera?.height ?? 0;
  const panel = { width: Math.max(PANEL.width, notch.width), height: PANEL.height + inset };
  const win = vertical
    ? { width: panel.width + MARGIN, height: panel.height + MARGIN * 2 }
    : { width: panel.width + MARGIN * 2, height: panel.height + MARGIN };
  return {
    edge,
    displayId: display.id,
    camera: Boolean(camera),
    inset,
    margin: MARGIN,
    notch,
    panel,
    bounds: edgeRect(area, edge, win),
    notchRect: edgeRect(area, edge, notch),
    panelRect: edgeRect(area, edge, panel),
  };
}

/** True when another screen continues past the middle of this edge, so the pointer doesn't stop there. */
function innerEdge(display, edge, all) {
  const b = display.bounds;
  const p = {
    right: { x: b.x + b.width, y: b.y + b.height / 2 },
    left: { x: b.x - 1, y: b.y + b.height / 2 },
    bottom: { x: b.x + b.width / 2, y: b.y + b.height },
    top: { x: b.x + b.width / 2, y: b.y - 1 },
  }[edge];
  return all.some(
    ({ id, bounds: o }) =>
      id !== display.id && p.x >= o.x && p.x < o.x + o.width && p.y >= o.y && p.y < o.y + o.height,
  );
}

/** For the settings page: every screen and where the drawer is now. */
export function placementInfo() {
  const { edge, displayId } = layout();
  const all = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  return {
    edge,
    displayId,
    displays: all.map((d, i) => ({
      id: d.id,
      label: d.label || (d.id === primaryId ? "Main screen" : `Screen ${i + 1}`),
      primary: d.id === primaryId,
      camera: cameraNotches.has(d.id),
      bounds: d.bounds,
      inner: Object.fromEntries(EDGES.map((e) => [e, innerEdge(d, e, all)])),
    })),
  };
}
