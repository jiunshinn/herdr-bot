// What app-preload.cjs exposes to the control-center page.

export type Edge = "top" | "right" | "bottom" | "left";

export interface ScreenInfo {
  id: number;
  label: string;
  /** The main screen (macOS: the one with the menu bar in Displays settings). */
  primary: boolean;
  /** A MacBook screen with a camera notch. */
  camera: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  /** Edges where another screen continues, so the pointer doesn't stop at the notch. */
  inner: Record<Edge, boolean>;
}

/** Where the drawer is now, and every screen it can go to (placement.js). */
export interface Placement {
  edge: Edge;
  displayId: number;
  displays: ScreenInfo[];
}

export interface Bridge {
  config(): Promise<{ url: string; token: string; platform: string }>;
  /** The drawer (or a notification) asked to show this agent. */
  onSelect(fn: (agentId: string) => void): void;
  openSetup(): void;
  placement(): Promise<Placement>;
  setPlacement(choice: { edge: Edge; displayId: number }): Promise<Placement>;
  /** Screens were added, removed or rearranged. Returns a function that stops listening. */
  onPlacement(fn: (placement: Placement) => void): () => void;
}

declare global {
  interface Window {
    hb: Bridge;
  }
}

export const bridge = window.hb;
