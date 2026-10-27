import { useLayoutEffect, useRef } from "react";

/** A full-width rule in the agent's UI, e.g. the borders of Claude Code's input box. */
const RULE = /^\s*[─━═]{8,}\s*$/;
/** Indent plus a list or message marker: wrapped text lines up after it, as in the real pane. */
const HANG = /^\s*(?:(?:[-*•⎿⏺●✻※]|\d+[.)])\s+)?/;
const MAX_HANG = 24;

/**
 * Text from the agent's pane. The pane is often wider than this view, so long lines wrap again
 * here; each wrapped line keeps its indent instead of starting at the left edge.
 */
export function Terminal({ text, className = "terminal" }: { text: string | null; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow new output only while the user is at the bottom.
  const onScroll = () => {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useLayoutEffect(() => {
    if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [text]);

  return (
    <div className={className} ref={scroller} onScroll={onScroll}>
      {text === null
        ? "Loading…"
        : text.split("\n").map((line, i) =>
            RULE.test(line) ? (
              <div key={i} className="term-rule" />
            ) : (
              <div key={i} className="term-line" style={hang(line)}>
                {line}
              </div>
            ),
          )}
    </div>
  );
}

function hang(line: string) {
  const n = Math.min(HANG.exec(line)![0].length, MAX_HANG);
  return n ? { paddingLeft: `${n}ch`, textIndent: `-${n}ch` } : undefined;
}
