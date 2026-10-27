// What app-preload.cjs exposes to the control-center page.

export interface Bridge {
  config(): Promise<{ url: string; token: string; platform: string }>;
  /** The drawer (or a notification) asked to show this agent. */
  onSelect(fn: (agentId: string) => void): void;
  openSetup(): void;
}

declare global {
  interface Window {
    hb: Bridge;
  }
}

export const bridge = window.hb;
