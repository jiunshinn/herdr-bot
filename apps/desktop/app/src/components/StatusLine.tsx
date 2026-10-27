import type { AgentMeta } from "@herdr-bot/protocol";
import { shortPath } from "../util";

interface Props {
  meta: AgentMeta;
  cwd: string;
}

/** The agent's own status line: model · effort │ folder · branch │ context │ permission mode. */
export function StatusLine({ meta, cwd }: Props) {
  const { model, effort, branch, context, permissions } = meta;
  const folder = cwd.split("/").filter(Boolean).pop() ?? cwd;
  const pct = context ? Math.min(100, Math.round((context.used / context.window) * 100)) : null;

  return (
    <div className="statusline">
      {model && (
        <span className="sl-group">
          <span className="sl-model">{model}</span>
          {effort && <span className="sl-effort">{effort}</span>}
        </span>
      )}
      <span className="sl-group" title={shortPath(cwd)}>
        <span className="sl-folder">{folder}</span>
        {branch && <span className="sl-branch">{branch}</span>}
      </span>
      {context && pct !== null && (
        <span
          className="sl-group sl-context"
          data-level={pct >= 90 ? "high" : pct >= 70 ? "mid" : "low"}
          title={`${tokens(context.used)} of ${tokens(context.window)} tokens`}
        >
          <span className="sl-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="sl-pct">{pct}%</span>
        </span>
      )}
      {permissions && (
        <span className="sl-group sl-mode" data-level={permissions.level}>
          {permissions.level !== "ask" && "⏵⏵ "}
          {permissions.label}
        </span>
      )}
    </div>
  );
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
