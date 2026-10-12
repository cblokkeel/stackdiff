import { useState } from "react";
import type { Verdict } from "../src/types";
import { plural, pluralWord } from "./text";

export function SubmitDialog(props: {
  unsentMessages: number;
  unsentByChunk: { label: string; count: number }[];
  unapprovedChunks: number;
  initialNote: string;
  onSend: (verdict: Verdict, note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(props.initialNote);
  const canRequestChanges = props.unsentMessages > 0 || note.trim() !== "";
  // Approve ends the agent's run, so it is never the default while chunks are left.
  const approveEarly = props.unapprovedChunks > 0;

  return (
    <div className="overlay" onClick={props.onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="submit-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && props.onClose()}
      >
        <div className="dialog-body">
          <h3 id="submit-title">Submit review</h3>
          <ul className="summary-list">
            <li>
              {props.unsentMessages > 0 ? (
                <>
                  <b>{props.unsentMessages}</b> {pluralWord(props.unsentMessages, "unsent message")} will go to the
                  agent, from every chunk:
                  <ul className="unsent-groups">
                    {props.unsentByChunk.map((g) => (
                      <li key={g.label}>
                        <span className="ellipsis">{g.label}</span>
                        <span className="muted">{plural(g.count, "message")}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                "No unsent messages"
              )}
            </li>
            {props.unapprovedChunks > 0 && (
              <li className="warn">
                <b>{props.unapprovedChunks}</b> {pluralWord(props.unapprovedChunks, "chunk")} not approved
              </li>
            )}
          </ul>
          <textarea
            autoFocus
            rows={4}
            value={note}
            aria-label="Overall note"
            placeholder="Overall note (optional)"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canRequestChanges) props.onSend("changes", note);
            }}
          />
        </div>
        <div className="dialog-footer">
          <button onClick={props.onClose}>Cancel</button>
          <div className="spacer" />
          <button
            className={approveEarly ? "danger" : canRequestChanges ? "" : "primary"}
            onClick={() => props.onSend("approve", note)}
          >
            {approveEarly ? `Approve with ${plural(props.unapprovedChunks, "chunk")} left` : "Approve"}
          </button>
          <button
            className={canRequestChanges ? "primary" : ""}
            disabled={!canRequestChanges}
            onClick={() => props.onSend("changes", note)}
          >
            Request changes
          </button>
        </div>
      </div>
    </div>
  );
}
