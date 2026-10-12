import { useState } from "react";
import { isResolved, threadState, unsentCount } from "../src/review";
import type { ViewChunk, ViewComment } from "../src/types";
import { useActions } from "./actions";
import { lineLabel, plural } from "./text";
import { QuestionIcon, ThreadCard, useThreadStatus } from "./Thread";
import { useUndoable } from "./undo";

export const LOST_LABEL = "No longer in the change";

export function CommentsPanel(props: {
  chunks: ViewChunk[];
  currentIndex: number;
  threads: ViewComment[];
  onJump: (thread: ViewComment) => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const visible = props.threads.filter((t) => showResolved || !isResolved(t));
  const resolvedCount = props.threads.filter(isResolved).length;
  const lost = visible.filter((t) => t.chunkKey === null);

  return (
    <div className="threads-panel">
      {props.threads.length > 0 && (
        <div className="threads-tools">
          <label className="muted small check">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
        </div>
      )}

      {props.threads.length === 0 && (
        <div className="empty">
          <b>No threads yet</b>
          <span className="muted">Hover a line and click + to start a thread.</span>
        </div>
      )}
      {props.threads.length > 0 && visible.length === 0 && (
        <div className="empty">
          <b>No open threads</b>
          <span className="muted">
            {resolvedCount} resolved.{" "}
            <button className="link" onClick={() => setShowResolved(true)}>
              Show them
            </button>
          </span>
        </div>
      )}

      {props.chunks.map((chunk, i) => {
        const threads = visible.filter((t) => t.chunkKey === chunk.key);
        if (threads.length === 0) return null;
        return (
          <div key={chunk.key} className={`drawer-group ${i === props.currentIndex ? "current" : ""}`}>
            <div className="drawer-chunk">
              <span className="num">{i + 1}</span>
              {chunk.title}
            </div>
            {threads.map((t) => (
              <ThreadLink key={t.id} thread={t} onClick={() => props.onJump(t)} />
            ))}
          </div>
        );
      })}

      {lost.length > 0 && (
        <div className="drawer-group">
          <div className="drawer-chunk">
            {LOST_LABEL}
            <SendLostButton threads={lost} />
          </div>
          <p className="muted small drawer-note">The code these threads were on has left the diff.</p>
          {lost.map((t) => (
            <div key={t.id} className="drawer-item">
              <div className="drawer-loc path">{t.file}</div>
              <ThreadCard thread={t} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** No chunk shows these threads, so the chunk's Send can't reach them. */
function SendLostButton({ threads }: { threads: ViewComment[] }) {
  const actions = useActions();
  const undoable = useUndoable();
  const unsent = unsentCount(threads);
  if (unsent === 0) return null;
  const ids = threads.filter((t) => t.messages.some((m) => !m.sent)).map((t) => t.id);
  const count = plural(unsent, "message");
  return (
    <button
      className="primary drawer-send"
      onClick={() => undoable(`Sending ${count}…`, (wait) => actions.sendThreads(ids, wait), `${count} sent to the agent.`)}
    >
      Send {count}
    </button>
  );
}

function ThreadLink({ thread, onClick }: { thread: ViewComment; onClick: () => void }) {
  const state = threadState(thread);
  const status = useThreadStatus(thread);
  const first = thread.messages[0];
  const last = thread.messages.at(-1);
  return (
    <button className={`thread-link thread-link-${state}`} onClick={onClick}>
      <div className="thread-link-head">
        {thread.kind === "question" && <QuestionIcon />}
        <span className={`badge badge-${status.badge}`}>{status.label}</span>
        <span className="muted ellipsis">
          {thread.file.split("/").pop()}:{lineLabel(thread.startLine, thread.endLine)}
        </span>
      </div>
      {first && <div className="thread-link-body">{first.body}</div>}
      {last && last !== first && (
        <div className="thread-link-last">
          <b>{last.author === "agent" ? "Agent" : "You"}:</b> {last.body}
        </div>
      )}
    </button>
  );
}
