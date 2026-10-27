export interface HerdrCheck {
  installed: boolean;
  /** Installed and at least minVersion. */
  ok: boolean;
  path?: string;
  version?: string;
  minVersion?: string;
}

export interface IntegrationCheck {
  integration: string;
  label: string;
  agentPath: string;
  /** Herdr's own words, e.g. "current (v11)" or "not installed". */
  state: string;
  installed: boolean;
  outdated: boolean;
}

export interface TailscaleCheck {
  installed: boolean;
  running: boolean;
  backendState?: string;
  ip?: string;
  dnsName?: string;
}

export interface MachineCheck {
  id: string;
  label: string;
  status: string;
  reachable: boolean;
}

export interface SetupReport {
  platform: string;
  herdr: HerdrCheck;
  server: { running: boolean };
  integrations: IntegrationCheck[];
  tailscale: TailscaleCheck;
  machines: MachineCheck[];
}

export const AGENTS: { integration: string; bin: string; label: string }[];
export const HERDR_INSTALL_COMMAND: string;
export const TAILSCALE_DOWNLOAD_URL: string;

export function searchPath(): Promise<string>;
export function resetSearchPath(): void;
export function findBinary(name: string): Promise<string | null>;
export function run(
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }>;
export function checkSetup(): Promise<SetupReport>;
export function installHerdr(onLine?: (line: string) => void): Promise<{ ok: boolean; code: number }>;
export function installIntegration(name: string, onLine?: (line: string) => void): Promise<{ ok: boolean; code: number }>;
export function startHerdrServer(): Promise<{ ok: boolean }>;
