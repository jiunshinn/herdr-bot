import { useEffect, useRef, useState } from "react";
import { bridge, type Edge, type Placement, type ScreenInfo } from "../bridge";

const EDGES: Edge[] = ["top", "left", "right", "bottom"];
const EDGE_LABEL: Record<Edge, string> = { top: "Top", left: "Left", right: "Right", bottom: "Bottom" };
const MAP_HEIGHT = 240;
const GAP = 4; // px between screens on the map; real screens touch

export function Settings({ platform }: { platform: string }) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bridge.placement().then(setPlacement, (err) => setError((err as Error).message));
    return bridge.onPlacement(setPlacement);
  }, []);

  const choose = (displayId: number, edge: Edge) => {
    setError(null);
    bridge.setPlacement({ displayId, edge }).then(setPlacement, (err) => setError((err as Error).message));
  };

  const current = placement?.displays.find((d) => d.id === placement.displayId);
  const shortcut = platform === "darwin" ? "⌘⌥H" : "Ctrl+Alt+H";

  return (
    <section className="overview settings">
      <header className="drag overview-head">
        <h1>Settings</h1>
      </header>
      <div className="overview-body">
        <h2>Drawer position</h2>
        <p className="muted settings-lead">
          Click an edge of a screen. The drawer's notch sits in the middle of that edge. {shortcut} opens the drawer
          from anywhere.
        </p>

        {placement && current ? (
          <>
            <ScreenMap placement={placement} onChoose={choose} />

            <div className="placement-controls">
              <label className="field">
                <span className="muted">Screen</span>
                <select value={placement.displayId} onChange={(e) => choose(Number(e.target.value), placement.edge)}>
                  {placement.displays.map((d) => (
                    <option key={d.id} value={d.id}>
                      {screenName(d)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span className="muted">Edge</span>
                <div className="tabs" role="radiogroup" aria-label="Edge">
                  {EDGES.map((edge) => (
                    <button
                      key={edge}
                      role="radio"
                      aria-checked={placement.edge === edge}
                      className={placement.edge === edge ? "active" : ""}
                      onClick={() => choose(placement.displayId, edge)}
                    >
                      {EDGE_LABEL[edge]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <PlacementHint screen={current} edge={placement.edge} platform={platform} shortcut={shortcut} />
          </>
        ) : (
          !error && <p className="muted">Reading your screens…</p>
        )}
        {error && <p className="settings-error">{error}</p>}
      </div>
    </section>
  );
}

function screenName(d: ScreenInfo): string {
  return d.primary ? `Main screen · ${d.label}` : d.label;
}

/** The screens as arranged in the OS display settings, with a target on each edge. */
function ScreenMap({ placement, onChoose }: { placement: Placement; onChoose(displayId: number, edge: Edge): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);

  const { displays } = placement;
  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const minY = Math.min(...displays.map((d) => d.bounds.y));
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  const scale = Math.min(width / (maxX - minX), MAP_HEIGHT / (maxY - minY));

  return (
    <div ref={ref} className="screen-map-wrap">
      <div className="screen-map" style={{ width: (maxX - minX) * scale, height: (maxY - minY) * scale }}>
        {displays.map((d) => {
          const here = d.id === placement.displayId;
          return (
            <div
              key={d.id}
              className={`screen${here ? " current" : ""}${d.camera ? " has-camera" : ""}`}
              style={{
                left: (d.bounds.x - minX) * scale + GAP / 2,
                top: (d.bounds.y - minY) * scale + GAP / 2,
                width: d.bounds.width * scale - GAP,
                height: d.bounds.height * scale - GAP,
              }}
            >
              {d.camera && <span className="screen-camera" />}
              <span className="screen-name">
                <span>{d.label}</span>
                {d.primary && <span className="screen-main">Main</span>}
              </span>
              {EDGES.map((edge) => {
                const selected = here && placement.edge === edge;
                return (
                  <button
                    key={edge}
                    className={`screen-edge${selected ? " selected" : ""}${d.inner[edge] ? " inner" : ""}`}
                    data-edge={edge}
                    aria-pressed={selected}
                    aria-label={`${d.label}, ${EDGE_LABEL[edge].toLowerCase()} edge`}
                    title={`${EDGE_LABEL[edge]} edge${d.inner[edge] ? " (another screen continues here)" : ""}`}
                    onClick={() => onChoose(d.id, edge)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlacementHint({
  screen,
  edge,
  platform,
  shortcut,
}: {
  screen: ScreenInfo;
  edge: Edge;
  platform: string;
  shortcut: string;
}) {
  let hint: string | null = null;
  if (screen.inner[edge]) {
    hint = `Another screen continues past this edge, so the pointer doesn't stop at the notch. Rest the pointer on the notch, or press ${shortcut}.`;
  } else if (edge === "top" && screen.camera) {
    hint = "The notch wraps the camera at the top of this MacBook screen. Move the pointer to the camera to open the drawer.";
  } else if (edge === "top" && platform === "darwin") {
    hint = "The notch covers the middle of the menu bar.";
  } else if (edge === "bottom" && platform === "darwin") {
    hint = "If the Dock hides automatically at the bottom, it can also open when you go to the notch.";
  }
  return hint ? <p className="muted placement-hint">{hint}</p> : null;
}
