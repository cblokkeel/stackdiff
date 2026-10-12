import type { ViewState } from "../src/types";
import { DiffStat } from "./ChunkView";
import { Markdown } from "./Markdown";
import { plural } from "./text";

/** The overview sits before chunk 1, so `k` on chunk 1 reaches it. */
export const OVERVIEW_INDEX = -1;

export function OverviewView(props: { state: ViewState; onGo: (index: number) => void }) {
  const { chunks } = props.state;
  const added = chunks.reduce((n, c) => n + c.added, 0);
  const removed = chunks.reduce((n, c) => n + c.removed, 0);
  const firstUnreviewed = chunks.findIndex((c) => !c.reviewed);
  const startAt = Math.max(firstUnreviewed, 0);
  const label = firstUnreviewed <= 0 ? "Start review" : `Continue at chunk ${firstUnreviewed + 1}`;

  return (
    <>
      <div className="chunk-head">
        <div className="chunk-meta">
          <span className="chunk-pos">Overview</span>
          <span>{plural(chunks.length, "chunk")}</span>
          <DiffStat added={added} removed={removed} />
        </div>
        <h2>{props.state.title || "Overview"}</h2>
        {props.state.summary && <p className="desc">{props.state.summary}</p>}
      </div>

      <Markdown className="overview-body" source={props.state.overview} />

      {chunks.length > 0 && (
        <div className="chunk-foot">
          <span className="foot-title">
            <span className="ellipsis">Read this first. It stays at the top of the sidebar.</span>
          </span>
          <button className="primary" onClick={() => props.onGo(startAt)}>
            {label} {startAt === 0 && <kbd>j</kbd>}
          </button>
        </div>
      )}
    </>
  );
}
