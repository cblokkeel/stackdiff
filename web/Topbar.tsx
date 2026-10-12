import { useEffect, useRef, useState } from "react";
import { DockIcon } from "./Dock";
import type { DiffStyle } from "./FileBlock";

export function Topbar(props: {
  branch: string;
  base: string;
  online: boolean;
  diffStyle: DiffStyle;
  onDiffStyle: (style: DiffStyle) => void;
  unsentMessages: number;
  unsentInChunk: number;
  dockOpen: boolean;
  unreadChat: number;
  onToggleDock: () => void;
  onSubmit: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 3h8M2 6h5M2 9h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        stackdiff
      </div>
      <div className="crumbs">
        <span className="branch">{props.branch}</span>
        <span className="muted">vs {props.base}</span>
      </div>
      {!props.online && <span className="pill pill-warn">Server offline, retrying</span>}
      <div className="spacer" />
      <div className="seg">
        {(["unified", "split"] as const).map((style) => (
          <button
            key={style}
            className={props.diffStyle === style ? "on" : ""}
            onClick={() => props.onDiffStyle(style)}
          >
            {style === "unified" ? "Unified" : "Split"}
          </button>
        ))}
      </div>
      <button title={submitHint(props.unsentMessages, props.unsentInChunk)} onClick={props.onSubmit}>
        Submit review
        {props.unsentMessages > 0 && <Count n={props.unsentMessages} />}
      </button>
      <DockIcon open={props.dockOpen} unread={props.unreadChat} onToggle={props.onToggleDock} />
    </header>
  );
}

function submitHint(unsent: number, inChunk: number): string {
  if (unsent === 0) return "Approve or send a note";
  const here = inChunk > 0 && inChunk < unsent ? `, ${inChunk} in this chunk` : "";
  return `Send all ${unsent} unsent ${unsent === 1 ? "message" : "messages"}${here}`;
}

function Count({ n }: { n: number }) {
  const prev = useRef(n);
  const [bumps, setBumps] = useState(0);
  useEffect(() => {
    if (n > prev.current) setBumps((b) => b + 1);
    prev.current = n;
  }, [n]);
  return (
    <span key={bumps} className={`count ${bumps ? "bump" : ""}`}>
      {n}
    </span>
  );
}
