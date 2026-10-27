import { useEffect, useMemo, useState } from "react";
import { Terminal } from "./Terminal";

export interface Choice {
  n: number;
  label: string;
  detail: string;
  /** The agent's cursor is on it, so Enter picks it. */
  current: boolean;
}

export interface Question {
  text: string;
  /** Lines between the question and the options, e.g. the command Codex asks to run. */
  context: string;
  /** A warning above the question, e.g. Claude Code's auto-deny countdown. */
  note: string;
  choices: Choice[];
}

/** "❯ 1. Yes": Claude Code marks the cursor with ❯, Codex with ›, Gemini with ●. */
const OPTION = /^(\s*)([❯›▸▶→●]\s*)?(\d{1,2})[.)]\s+(.*)$/;
const BORDER = /^\s*[│┃] ?| ?[│┃]\s*$/g;
const RULE = /^\s*[─━═╌╭╮╰╯]{3,}\s*$/;
/** Codex and Claude Code end a label with its shortcut, e.g. "(y)" or "(esc)". */
const SHORTCUT = /\s+\((?:esc|[a-z])\)$/i;
const TAIL = 40;
/** Most lines between two options: descriptions and wrapped labels. */
const MAX_GAP = 6;

/**
 * The numbered choice the agent waits on, read from the end of its pane. Null when the pane
 * has no numbered list with the agent's cursor on it.
 */
export function parseQuestion(pane: string): Question | null {
  const lines = pane
    .split("\n")
    .slice(-TAIL)
    .map((l) => l.replace(BORDER, "").trimEnd());
  const width = Math.max(...lines.map((l) => l.length));

  // The last run of options numbered 1, 2, 3…, read from the bottom up.
  const at: number[] = [];
  let expect = 0;
  let gap = 0;
  for (let i = lines.length - 1; i >= 0 && expect !== 1; i--) {
    const m = OPTION.exec(lines[i]!);
    const n = m ? Number(m[3]) : 0;
    if (m && (at.length === 0 || n === expect - 1)) {
      at.unshift(i);
      expect = n;
      gap = 0;
    } else if (at.length && (m || ++gap > MAX_GAP)) {
      return null;
    }
  }
  if (expect !== 1) return null;

  const choices = at.map((i, k): Choice => {
    const m = OPTION.exec(lines[i]!)!;
    const labelCol = lines[i]!.length - m[4]!.length;
    const end = at[k + 1] ?? lines.length;
    let label = m[4]!;
    let lineLen = lines[i]!.length;
    const detail: string[] = [];
    for (let j = i + 1; j < end; j++) {
      const line = lines[j]!;
      // Text under the label belongs to the option; a blank line or a rule ends the last one.
      if (!line.trim() || RULE.test(line)) {
        if (k === at.length - 1) break;
        continue;
      }
      if (indent(line) < labelCol - 1) break;
      // A label that reached the pane's edge wrapped onto this line.
      if (!detail.length && lineLen >= width - 12) label += ` ${line.trim()}`;
      else detail.push(line.trim());
      lineLen = line.length;
    }
    return { n: Number(m[3]), label: label.replace(SHORTCUT, ""), detail: detail.join(" "), current: Boolean(m[2]) };
  });
  if (!choices.some((c) => c.current)) return null;

  // The question: the nearest paragraph above the options that ends with "?".
  let q = -1;
  for (let i = at[0]! - 1; i >= Math.max(0, at[0]! - 12); i--) {
    if (lines[i]!.trim().endsWith("?")) {
      q = i;
      break;
    }
  }
  let text = "Choose an option";
  let context = "";
  let top = at[0]!;
  if (q >= 0) {
    top = q;
    while (top > 0 && q - top < 2 && lines[top - 1]!.trim() && !RULE.test(lines[top - 1]!)) top--;
    text = lines.slice(top, q + 1).map((l) => l.trim()).join(" ");
    const between = lines.slice(q + 1, at[0]).filter((l) => !RULE.test(l));
    const left = Math.min(...between.filter((l) => l.trim()).map(indent));
    context = between.map((l) => l.slice(left)).join("\n").trim();
  }

  let note = "";
  for (let i = top - 1; i >= Math.max(0, top - 12); i--) {
    if (!lines[i]!.trim().startsWith("⚠")) continue;
    const para: string[] = [];
    for (let j = i; j < top && lines[j]!.trim(); j++) para.push(lines[j]!.trim());
    note = para.join(" ").replace(/^⚠\s*/, "");
    break;
  }

  return { text, context, note, choices };
}

function indent(line: string): number {
  return line.length - line.trimStart().length;
}

interface Props {
  title: string;
  /** The end of the agent's pane. */
  pane: string | null;
  /** False when the terminal is already on screen. */
  canShowPane: boolean;
  onKeys(keys: string[]): void;
}

/** The agent's numbered question as buttons. Falls back to the pane and raw keys when it can't be read. */
export function QuestionCard({ title, pane, canShowPane, onKeys }: Props) {
  const question = useMemo(() => (pane ? parseQuestion(pane) : null), [pane]);
  const [showPane, setShowPane] = useState(false);
  const [pending, setPending] = useState(false);

  // After a pick, wait until the question changes, so a double click doesn't answer the next one too.
  const shape = question ? [question.text, ...question.choices.map((c) => c.label)].join("\n") : pane;
  useEffect(() => setPending(false), [shape]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), 3000);
    return () => clearTimeout(t);
  }, [pending]);

  const pick = (n: number) => {
    if (pending) return;
    setPending(true);
    onKeys([String(n)]);
  };

  // Number keys answer, as in the agent's own terminal.
  useEffect(() => {
    if (!question) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      const c = question.choices.find((c) => String(c.n) === e.key);
      if (c) pick(c.n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!question) {
    return (
      <div className="question">
        <div className="question-title">{title}</div>
        {canShowPane && <Terminal className="snippet" text={pane && lastLines(pane, 14)} />}
        <div className="choice-keys">
          {["1", "2", "3"].map((k) => (
            <button key={k} onClick={() => onKeys([k])}>
              {k}
            </button>
          ))}
          <button onClick={() => onKeys(["enter"])}>Enter</button>
          <button onClick={() => onKeys(["esc"])}>Esc</button>
        </div>
      </div>
    );
  }

  return (
    <div className="question">
      <div className="question-title">{title}</div>
      <div className="question-text">{question.text}</div>
      {question.context && <pre className="question-context">{question.context}</pre>}
      {question.note && <div className="question-note">⚠ {question.note}</div>}
      <div className="choices">
        {question.choices.map((c) => (
          <button
            key={c.n}
            className={`choice${c.current ? " current" : ""}`}
            disabled={pending}
            onClick={() => pick(c.n)}
          >
            <span className="choice-n">{c.n}</span>
            <span className="choice-body">
              <span className="choice-label">{c.label}</span>
              {c.detail && <span className="choice-detail">{c.detail}</span>}
            </span>
          </button>
        ))}
      </div>
      {showPane && <Terminal className="snippet" text={pane && lastLines(pane, 30)} />}
      <div className="question-foot">
        {canShowPane && (
          <button className="link" onClick={() => setShowPane(!showPane)}>
            {showPane ? "Hide terminal" : "Show terminal"}
          </button>
        )}
        <span className="question-keys">
          <button className="keycap" onClick={() => onKeys(["enter"])}>
            Enter
          </button>
          <button className="keycap" onClick={() => onKeys(["esc"])}>
            Esc
          </button>
        </span>
      </div>
    </div>
  );
}

function lastLines(text: string, n: number): string {
  return text.split("\n").slice(-n).join("\n");
}
