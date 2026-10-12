import { Fragment, useContext, useEffect, useRef } from "react";
import type { ChatCode, ViewChatMessage } from "../src/types";
import { useActions } from "./actions";
import { stableKey } from "./tempIds";
import { useUndoable } from "./undo";
import { lineLabel } from "./text";
import { AgentListeningContext, Bubble, ChatInput, Thinking } from "./Thread";

const EXAMPLES = ["Move chunk 3 before chunk 1", "Merge the last two chunks", "Why this approach?"];

const SENDING = { label: "Sending", hint: "The agent is listening and gets it in a moment" };
const QUEUED = { label: "Queued", hint: "The agent reads it the next time it runs stackdiff wait" };

/**
 * The agent thinks about the user messages it has received since its last reply.
 * Returns the last of those, where the thinking bubble goes; messages after it wait their turn.
 */
function thinkingAfter(chat: ViewChatMessage[]): number {
  const lastReply = chat.findLastIndex((m) => m.author === "agent");
  return chat.findLastIndex((m, i) => i > lastReply && m.seen);
}

/** Decided by whether the agent listens, not by whether the server has answered yet, so the label doesn't flip on send. */
function statusOf(m: ViewChatMessage, agentListening: boolean) {
  if (m.author === "agent" || m.seen) return undefined;
  return agentListening ? SENDING : QUEUED;
}

/** A chat with the agent about anything: the plan, the order of chunks, some lines, the change as a whole. */
export function ChatPanel(props: {
  chat: ViewChatMessage[];
  /** The chunk on screen, sent with each message so "this chunk" means something. */
  chunk: { title: string } | null;
  /** The input takes focus whenever this changes. */
  focusKey: number;
  /** Lines to send with the next message, and text to add to the box. */
  draft: { code: ChatCode | null; text: string; key: number };
  onDropCode: () => void;
  onRestoreCode: (code: ChatCode) => void;
  onJumpToCode: (code: ChatCode) => void;
}) {
  const actions = useActions();
  const undoable = useUndoable();
  const agentListening = useContext(AgentListeningContext);
  const thinking = thinkingAfter(props.chat);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    log?.scrollTo({ top: log.scrollHeight });
  }, [props.chat.length, thinking]);

  const send = (body: string) => {
    const code = props.draft.code;
    if (code) props.onDropCode();
    return actions.sendChat(body, props.chunk?.title, code ?? undefined).then((ok) => {
      if (!ok && code) props.onRestoreCode(code);
      return ok;
    });
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-log" ref={logRef} aria-live="polite">
        {props.chat.length === 0 && (
          <div className="empty">
            <b>Talk to the agent</b>
            <span className="muted">
              Ask about the change, or have it reorder, split or merge chunks. To ask about some lines, select them
              and pick Ask in chat.
            </span>
            <div className="chat-examples">
              {EXAMPLES.map((text) => (
                <span key={text} className="chat-example">
                  {text}
                </span>
              ))}
            </div>
          </div>
        )}
        {props.chat.map((m, i) => (
          <Fragment key={stableKey(m.id)}>
            <Bubble
              message={m}
              status={statusOf(m, agentListening)}
              action={
                statusOf(m, agentListening) === QUEUED
                  ? {
                      label: "Cancel message",
                      icon: (
                        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                          <path d="M2.5 2.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      ),
                      onClick: () => undoable("Message cancelled.", (wait) => actions.cancelChat(m.id, wait)),
                    }
                  : undefined
              }
              quote={m.code && <CodeQuote code={m.code} onClick={() => props.onJumpToCode(m.code!)} />}
            />
            {i === thinking && <Thinking />}
          </Fragment>
        ))}
      </div>

      <ChatInput
        focusKey={props.focusKey}
        prefill={{ text: props.draft.text, key: props.draft.key }}
        placeholder={props.draft.code ? "Ask about these lines…" : "Message the agent…"}
        onSend={send}
        attachment={props.draft.code && <CodeQuote code={props.draft.code} onRemove={props.onDropCode} />}
      />
    </div>
  );
}

const QUOTE_MAX_LINES = 8;

/** Lines of code in the chat: in a message (click to jump to them) or attached to the next one (remove with ×). */
function CodeQuote(props: { code: ChatCode; onClick?: () => void; onRemove?: () => void }) {
  const { code } = props;
  const all = code.snippet.split("\n");
  const shown = all.slice(0, QUOTE_MAX_LINES);
  const name = code.file.split("/").pop();
  const where = `${name}:${lineLabel(code.startLine, code.endLine)}${code.side === "deletions" ? " (old)" : ""}`;

  const head = (
    <span className="code-quote-head">
      <span className="code-quote-file" title={code.file}>
        {where}
      </span>
    </span>
  );
  const body = (
    <pre className="code-quote-lines">
      {shown.map((line, i) => (
        <span key={i} className={`code-quote-line ${line[0] === "+" ? "add" : line[0] === "-" ? "del" : ""}`}>
          {line.slice(1) || " "}
        </span>
      ))}
      {all.length > shown.length && <span className="code-quote-more">+{all.length - shown.length} more lines</span>}
    </pre>
  );

  if (props.onRemove) {
    return (
      <div className="code-quote attached">
        <div className="code-quote-bar">
          {head}
          <button className="icon code-quote-remove" aria-label="Remove these lines" title="Remove" onClick={props.onRemove}>
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
              <path d="M3.5 3.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {body}
      </div>
    );
  }
  return (
    <button className="code-quote" title={`Go to ${code.file}`} onClick={props.onClick}>
      {head}
      {body}
    </button>
  );
}
