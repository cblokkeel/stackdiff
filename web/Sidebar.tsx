import { useEffect, useRef, useState } from "react";
import type { ViewChunk, ViewState } from "../src/types";
import { DiffStat } from "./ChunkView";
import { OVERVIEW_INDEX } from "./OverviewView";

export function Sidebar(props: {
  state: ViewState;
  currentIndex: number;
  openThreadsByChunk: Map<string, number>;
  onSelect: (index: number) => void;
  onSetReviewed: (chunk: ViewChunk, reviewed: boolean) => void;
}) {
  const { state, currentIndex } = props;
  const chunks = state.chunks;
  const approved = chunks.filter((c) => c.reviewed).length;
  const allApproved = chunks.length > 0 && approved === chunks.length;

  const [summaryOpen, setSummaryOpen] = useState(false);
  const stackRef = useRef<HTMLOListElement>(null);
  useKeepCurrentChunkInView(stackRef, currentIndex);

  return (
    <aside className="sidebar">
      <div className="plan-head">
        <h1>{state.title || (state.hasPlan ? "Untitled change" : "No plan yet")}</h1>
        {state.summary && (
          <p className={`summary ${summaryOpen ? "" : "clamp"}`}>{state.summary}</p>
        )}
        {state.summary && (
          <button className="link more" onClick={() => setSummaryOpen(!summaryOpen)}>
            {summaryOpen ? "Less" : "More"}
          </button>
        )}
        <div className={`progress ${allApproved ? "complete" : ""}`}>
          <div className="bar">
            <div style={{ transform: `scaleX(${chunks.length ? approved / chunks.length : 0})` }} />
          </div>
          <span className="progress-label">
            {allApproved ? "All approved" : `${approved}/${chunks.length} approved`}
          </span>
        </div>
      </div>

      <ol className="stack" ref={stackRef}>
        {state.overview.trim() && (
          <li
            className={`overview-row ${currentIndex === OVERVIEW_INDEX ? "active" : ""}`}
            aria-current={currentIndex === OVERVIEW_INDEX ? "step" : undefined}
            onClick={() => props.onSelect(OVERVIEW_INDEX)}
          >
            <svg className="overview-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path
                d="M3 3.5h10M3 6.5h10M3 9.5h6M3 12.5h4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span className="num" />
            <span className="title">Overview</span>
            <span className="meta">
              <kbd>o</kbd>
            </span>
          </li>
        )}
        {chunks.map((chunk, i) => {
          const openThreads = props.openThreadsByChunk.get(chunk.key) ?? 0;
          const classes = [
            i === currentIndex && "active",
            chunk.reviewed && "done",
            chunk.changedSinceApproval && "changed",
            chunk.unplanned && state.hasPlan && "unplanned",
          ];
          return (
            <li
              key={chunk.key}
              aria-current={i === currentIndex ? "step" : undefined}
              className={classes.filter(Boolean).join(" ")}
              onClick={() => props.onSelect(i)}
            >
              <input
                type="checkbox"
                className="tick"
                checked={chunk.reviewed}
                title={chunk.reviewed ? "Approved" : "Approve"}
                aria-label={`Approved: ${chunk.title}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => props.onSetReviewed(chunk, e.target.checked)}
              />
              <span className="num">{i + 1}</span>
              <span className="title">{chunk.title}</span>
              <span className="meta">
                {(chunk.changedSinceApproval || chunk.sinceReview) && (
                  <span
                    className="changed-mark"
                    title={chunk.changedSinceApproval ? "Changed after you approved it" : "Changed after you sent comments"}
                  >
                    Changed
                  </span>
                )}
                {openThreads > 0 && (
                  <span className="ccount" title="Open threads">
                    {openThreads}
                  </span>
                )}
                <DiffStat added={chunk.added} removed={chunk.removed} />
              </span>
            </li>
          );
        })}
      </ol>

    </aside>
  );
}

function useKeepCurrentChunkInView(stackRef: React.RefObject<HTMLOListElement | null>, currentIndex: number) {
  useEffect(() => {
    stackRef.current?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" });
  }, [stackRef, currentIndex]);
}
