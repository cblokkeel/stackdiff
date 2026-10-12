import { useDeferredValue } from "react";
import type { ViewChunk, ViewComment } from "../src/types";
import { ChunkVisual } from "./ChunkVisual";
import { type DiffStyle, FileBlock } from "./FileBlock";
import { plural } from "./text";

/** What a chunk changed since your last review shows against: the code you reviewed, or the base branch. */
export type Compare = "review" | "base";

const CHANGED_SINCE = { approving: "Changed since you approved.", commenting: "Changed since you sent comments." };

export function ChunkView(props: {
  chunk: ViewChunk;
  index: number;
  total: number;
  threads: ViewComment[];
  diffStyle: DiffStyle;
  visualOpen: boolean;
  onToggleVisual: () => void;
  compare: Compare;
  onToggleCompare: () => void;
  base: string;
  hasOverview: boolean;
  onGo: (index: number) => void;
  onSetReviewed: (chunk: ViewChunk, reviewed: boolean) => void;
  unsent: number;
  openThreads: number;
  onSend: () => void;
}) {
  const { chunk, index, total } = props;
  const isLast = index === total - 1;
  const backToOverview = index === 0 && props.hasOverview;
  // The header switches on the next frame; the diffs, the slow part, follow in a background render.
  const diffsChunk = useDeferredValue(chunk);
  const diffsReady = diffsChunk.key === chunk.key;
  const since = props.compare === "review" ? diffsChunk.sinceReview?.files : undefined;
  // Showing only changes, files that didn't change sink to the bottom so the changed ones come first.
  const unchanged = (path: string) => since?.[path] !== undefined && !since[path].patch;
  const files = [...diffsChunk.files.filter((f) => !unchanged(f.path)), ...diffsChunk.files.filter((f) => unchanged(f.path))];

  return (
    <>
      <div className="chunk-head">
        <div className="chunk-meta">
          <span className="chunk-pos">
            Chunk {index + 1} of {total}
          </span>
          <span>{plural(chunk.files.length, "file")}</span>
          <DiffStat added={chunk.added} removed={chunk.removed} />
          {chunk.reviewed && <span className="badge badge-resolved">Approved</span>}
          {chunk.changedSinceApproval && !chunk.sinceReview && (
            <span className="badge badge-changed">Changed since you approved</span>
          )}

        </div>
        <h2>{chunk.title}</h2>
        {chunk.description && <p className="desc">{chunk.description}</p>}
        {chunk.files.length > 1 && <FileList chunk={chunk} />}
        {chunk.visual && <ChunkVisual source={chunk.visual} open={props.visualOpen} onToggle={props.onToggleVisual} />}
        {chunk.sinceReview && (
          <div className="since-bar">
            <span>
              <b>{CHANGED_SINCE[chunk.sinceReview.by]}</b>{" "}
              {props.compare === "review"
                ? "Showing only what changed since then."
                : `Showing the whole chunk against ${props.base}.`}
            </span>
            <button
              aria-keyshortcuts="f"
              onClick={props.onToggleCompare}
            >
              {props.compare === "review" ? "Show whole chunk" : "Show only changes"} <kbd>f</kbd>
            </button>
          </div>
        )}
      </div>

      {diffsReady ? (
        <>
          {files.map((file) => (
            <FileBlock
              key={`${diffsChunk.key}:${file.path}:${since ? "review" : "base"}`}
              file={file}
              chunk={diffsChunk}
              threads={props.threads.filter((t) => t.file === file.path)}
              diffStyle={props.diffStyle}
              since={since?.[file.path]}
            />
          ))}
        </>
      ) : (
        <div className="diffs-pending" aria-busy="true" />
      )}

      <div className="chunk-foot">
        <button disabled={index === 0 && !backToOverview} onClick={() => props.onGo(index - 1)}>
          ← {backToOverview ? "Overview" : "Previous"} <kbd>k</kbd>
        </button>
        <span className="foot-title">
          <span className="num">
            {index + 1}/{total}
          </span>
          <span className="ellipsis">{chunk.title}</span>
        </span>
        {props.unsent > 0 && (
          <button className="primary" onClick={props.onSend}>
            Send {plural(props.unsent, "message")}
            {isLast ? "" : " & next"} <kbd>s</kbd>
          </button>
        )}
        {chunk.reviewed ? (
          <button onClick={() => props.onSetReviewed(chunk, false)}>
            Unapprove <kbd>a</kbd>
          </button>
        ) : (
          <button
            className={props.unsent > 0 ? "" : "primary"}
            onClick={() => {
              props.onSetReviewed(chunk, true);
              props.onGo(index + 1);
            }}
          >
            {props.openThreads > 0 ? `Approve anyway (${props.openThreads} open)` : "Approve chunk"}
            {isLast ? "" : " & next"} <kbd>a</kbd>
          </button>
        )}
        <button disabled={isLast} onClick={() => props.onGo(index + 1)}>
          Next → <kbd>j</kbd>
        </button>
      </div>
    </>
  );
}

function FileList({ chunk }: { chunk: ViewChunk }) {
  const jump = (path: string) => {
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .querySelector(`[data-file="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  };
  return (
    <ul className="file-list">
      {chunk.files.map((file) => (
        <li key={file.path}>
          <button className="file-link" title={file.path} onClick={() => jump(file.path)}>
            <span className="ellipsis">{file.path.split("/").pop()}</span>
            <DiffStat added={file.added} removed={file.removed} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="stat">
      {added > 0 && <span className="add">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="del">−{removed}</span>}
    </span>
  );
}
