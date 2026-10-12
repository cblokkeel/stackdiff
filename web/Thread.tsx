import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { STATE_LABEL, threadState } from "../src/review";
import type { Message as MessageData, ViewComment } from "../src/types";
import { useActions } from "./actions";
import { isNewItem } from "./fresh";
import { Markdown } from "./Markdown";
import { isTemp, stableKey } from "./tempIds";
import { useUndoable } from "./undo";
import { lineLabel, timeAgo } from "./text";

export const FOCUS_THREAD_EVENT = "stackdiff:focus-thread";

/** True while `stackdiff wait` runs, so a question reaches the agent at once. */
export const AgentListeningContext = createContext(false);

type ChatStatus = "sending" | "queued" | "answering" | "answered" | "resolved";

const CHAT_STATUS: Record<ChatStatus, { label: string; badge: string }> = {
  sending: { label: "Sending", badge: "waiting" },
  queued: { label: "Queued", badge: "pending" },
  answering: { label: "Agent is answering", badge: "live" },
  answered: { label: "Answered", badge: "answered" },
  resolved: { label: "Resolved", badge: "resolved" },
};

function chatStatus(thread: ViewComment, agentListening: boolean): ChatStatus {
  const last = thread.messages.at(-1);
  if (thread.status === "resolved") return "resolved";
  if (last?.author === "agent") return "answered";
  if (isTemp(thread.id) || (last && isTemp(last.id))) return "sending";
  if (thread.seen) return "answering";
  return agentListening ? "sending" : "queued";
}

/** The badge a thread shows, here and in the comments panel. */
export function useThreadStatus(thread: ViewComment): { label: string; badge: string } {
  const agentListening = useContext(AgentListeningContext);
  if (thread.kind === "question") return CHAT_STATUS[chatStatus(thread, agentListening)];
  const state = threadState(thread);
  return { label: STATE_LABEL[state], badge: state };
}

export function ThreadCard({ thread }: { thread: ViewComment }) {
  return thread.kind === "question" ? <QuestionThread thread={thread} /> : <CommentThread thread={thread} />;
}

function useOpenState(thread: ViewComment, startOpen: boolean) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => {
    const onFocus = (e: Event) => (e as CustomEvent<string>).detail === thread.id && setOpen(true);
    addEventListener(FOCUS_THREAD_EVENT, onFocus);
    return () => removeEventListener(FOCUS_THREAD_EVENT, onFocus);
  }, [thread.id]);
  return [open, setOpen] as const;
}

function useDeleteThread(thread: ViewComment) {
  const actions = useActions();
  const undoable = useUndoable();
  return () => undoable(`Thread ${thread.id} deleted.`, (wait) => actions.deleteThread(thread.id, wait));
}

function CommentThread({ thread }: { thread: ViewComment }) {
  const actions = useActions();
  const state = threadState(thread);
  const [open, setOpen] = useOpenState(thread, state !== "resolved");
  const [replying, setReplying] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew] = useState(() => isNewItem(thread.id));
  const deleteThread = useDeleteThread(thread);
  const undoable = useUndoable();

  const hasUnsent = thread.messages.some((m) => !m.sent);
  const canReply = state !== "draft" && !hasUnsent;
  const canResolve = canReply && thread.status === "open";
  const canReopen = state === "resolved";
  const canDelete = state !== "draft";

  return (
    <div className={`comment comment-${state} ${isNew ? "enter" : ""}`} data-thread-id={thread.id}>
      <ThreadHeader thread={thread} open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <>
          <CommentedCode thread={thread} />
          <div className="messages">
            {thread.messages.map((m) =>
              editingId === m.id ? (
                <Composer
                  key={stableKey(m.id)}
                  initial={m.body}
                  saveLabel="Save"
                  onSave={(body) => {
                    setEditingId(null);
                    actions.editMessage(thread.id, m.id, body);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <Message
                  key={stableKey(m.id)}
                  message={m}
                  onEdit={() => setEditingId(m.id)}
                  onDelete={() =>
                    undoable("Message deleted.", (wait) => actions.deleteMessage(thread.id, m.id, wait))
                  }
                />
              ),
            )}
          </div>
          {replying ? (
            <Composer
              placeholder={state === "resolved" ? "Reply to reopen this thread" : "Reply"}
              saveLabel="Add reply"
              onSave={(body) => {
                setReplying(false);
                actions.reply(thread.id, body);
              }}
              onCancel={() => setReplying(false)}
            />
          ) : (
            (canReply || canResolve || canReopen || canDelete) && (
              <div className="row comment-actions">
                {canReply && (
                  <button className="reply-field" onClick={() => setReplying(true)}>
                    Reply…
                  </button>
                )}
                {canResolve && (
                  <button onClick={() => actions.resolve(thread.id)}>
                    Resolve
                  </button>
                )}
                {canReopen && (
                  <button onClick={() => actions.reopen(thread.id)}>
                    Reopen
                  </button>
                )}
                {canDelete && (
                  <button className="link danger" onClick={deleteThread}>
                    Delete
                  </button>
                )}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

function QuestionThread({ thread }: { thread: ViewComment }) {
  const actions = useActions();
  const agentListening = useContext(AgentListeningContext);
  const status = chatStatus(thread, agentListening);
  const [open, setOpen] = useOpenState(thread, status !== "resolved");
  const [isNew] = useState(() => isNewItem(thread.id));
  const deleteThread = useDeleteThread(thread);

  return (
    <div className={`comment chat chat-${status} ${isNew ? "enter" : ""}`} data-thread-id={thread.id}>
      <ThreadHeader thread={thread} open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <>
          <CommentedCode thread={thread} />
          <div className="chat-log" aria-live="polite">
            {thread.messages.map((m) => (
              <Bubble key={stableKey(m.id)} message={m} />
            ))}
            {status === "answering" && <Thinking />}
          </div>
          {status === "queued" && (
            <p className="chat-note">
              The agent is busy. It gets this the next time it runs <code>stackdiff wait</code>.
            </p>
          )}
          {status === "resolved" ? (
            <div className="chat-tools chat-tools-resolved">
              <span className="spacer" />
              <button className="link" onClick={() => actions.reopen(thread.id)}>
                Reopen
              </button>
              <button className="link danger" onClick={deleteThread}>
                Delete
              </button>
            </div>
          ) : (
            <ChatInput
              onSend={(body) => actions.reply(thread.id, body)}
              tools={
                <>
                  <button className="link" onClick={() => actions.resolve(thread.id)}>
                    Resolve
                  </button>
                  <button className="link danger" onClick={deleteThread}>
                    Delete
                  </button>
                </>
              }
            />
          )}
        </>
      )}
    </div>
  );
}

export function Bubble(props: {
  message: MessageData;
  /** Shown above the text, inside the bubble: the code the message is about. */
  quote?: ReactNode;
  /** Replaces the time while the message has not reached the agent. */
  status?: { label: string; hint: string };
  /** An icon button after the status, like cancel on a queued message. `label` names it for screen readers and the tooltip. */
  action?: { label: string; icon: ReactNode; onClick: () => void };
}) {
  const { message } = props;
  const [isNew] = useState(() => isNewItem(message.id));
  const mine = message.author === "user";
  return (
    <div className={`bubble-row ${mine ? "mine" : "theirs"} ${isNew ? "enter" : ""}`}>
      <div className={`bubble ${props.quote ? "has-quote" : ""}`}>
        {props.quote}
        {mine ? <div className="bubble-text">{message.body}</div> : <Markdown source={message.body} />}
      </div>
      <div className="bubble-meta">
        {mine ? "You" : "Agent"} ·{" "}
        {props.status ? (
          <span className={`bubble-status bubble-status-${props.status.label.toLowerCase()}`} title={props.status.hint}>
            {props.status.label}
          </span>
        ) : (
          <time dateTime={message.at} title={new Date(message.at).toLocaleString()}>
            {timeAgo(message.at)}
          </time>
        )}
        {props.action && (
          <button
            className="icon bubble-action"
            aria-label={props.action.label}
            title={props.action.label}
            onClick={props.action.onClick}
          >
            {props.action.icon}
          </button>
        )}
      </div>
    </div>
  );
}

export function Thinking() {
  return (
    <div className="bubble-row theirs enter">
      <div className="thinking" role="status" aria-label="Agent is thinking">
        <span className="thinking-dots" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} />
          ))}
        </span>
        <span className="thinking-label">Thinking</span>
      </div>
    </div>
  );
}

export function ChatInput(props: {
  onSend: (body: string) => Promise<boolean>;
  tools?: ReactNode;
  placeholder?: string;
  /** The textarea takes focus whenever this changes, past 0. */
  focusKey?: number;
  /** Text to add to the box, once per new `key`. */
  prefill?: { text: string; key: number };
  /** Shown above the text box, inside the field. */
  attachment?: ReactNode;
}) {
  const [body, setBody] = useState("");
  useEffect(() => {
    const text = props.prefill?.text;
    if (text) setBody((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
  }, [props.prefill?.key]);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.focusKey) ref.current?.focus();
  }, [props.focusKey]);

  const send = () => {
    const text = body.trim();
    if (!text) return;
    setBody("");
    props.onSend(text).then((ok) => !ok && setBody(text));
  };

  return (
    <div className="chat-input">
      {props.attachment}
      <div className="chat-field">
        <textarea
          ref={ref}
          rows={1}
          value={body}
          aria-label={props.placeholder ?? "Ask a follow-up"}
          placeholder={props.placeholder ?? "Ask a follow-up…"}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="send"
          aria-label="Send"
          title="Send (Enter)"
          disabled={!body.trim()}
          onClick={send}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path
              d="M7 11.5v-9M3 6.5l4-4 4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {props.tools && (
        <div className="chat-tools">
          <span className="spacer" />
          {props.tools}
        </div>
      )}
    </div>
  );
}

/** The code the thread was left on, once the diff no longer shows it at the thread's lines. */
function CommentedCode({ thread }: { thread: ViewComment }) {
  const lost = thread.chunkKey === null;
  if (!thread.snippet || (!lost && !thread.codeChanged)) return null;
  const code = thread.snippet
    .split("\n")
    .map((line) => line.slice(1))
    .join("\n");
  return (
    <div className="commented-code">
      <div className="muted small">{lost ? "Commented on:" : "Code changed since. Commented on:"}</div>
      <pre>{code}</pre>
    </div>
  );
}

function ThreadHeader(props: { thread: ViewComment; open: boolean; onToggle: () => void }) {
  const { thread, open } = props;
  const status = useThreadStatus(thread);
  const first = thread.messages[0];
  return (
    <button className="comment-head" aria-expanded={open} onClick={props.onToggle}>
      {thread.kind === "question" && <QuestionIcon />}
      <span className={`badge badge-${status.badge}`}>{status.label}</span>
      <span className="muted">{lineLabel(thread.startLine, thread.endLine)}</span>
      {!open && first && <span className="muted ellipsis">{first.body}</span>}
      <span className="spacer" />
      {!open && thread.messages.length > 1 && <span className="muted small">{thread.messages.length} messages</span>}
      <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path
          d="M3 4.5 6 7.5 9 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function QuestionIcon() {
  return (
    <svg className="question-icon" width="14" height="14" viewBox="0 0 14 14" aria-label="Question">
      <path
        d="M2.5 3.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6l-2.5 2v-2h0a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Message(props: { message: MessageData; onEdit: () => void; onDelete: () => void }) {
  const m = props.message;
  const [isNew] = useState(() => isNewItem(m.id));
  const editable = !m.sent;
  return (
    <div className={`msg msg-${m.author} ${m.sent ? "" : "msg-unsent"} ${isNew ? "enter" : ""}`}>
      <div className="msg-head">
        <span className="msg-author">{m.author === "agent" ? "Agent" : "You"}</span>
        <span className="msg-time" title={new Date(m.at).toLocaleString()}>
          {timeAgo(m.at)}
        </span>
        {editable && (
          <>
            <span className="badge badge-draft">Unsent</span>
            <span className="spacer" />
            <button className="link" onClick={props.onEdit}>
              Edit
            </button>
            <button className="link danger" onClick={props.onDelete}>
              Delete
            </button>
          </>
        )}
      </div>
      <div className="msg-body">{m.body}</div>
    </div>
  );
}

/** The box for a new thread. "Ask in chat" takes the lines and the text to the chat instead. */
export function NewThreadComposer(props: {
  lines: string;
  initial?: string;
  onChange?: (body: string) => void;
  onSave: (body: string) => void;
  onAskInChat: (body: string) => void;
  onCancel: () => void;
}) {
  return (
    <Composer
      header={
        <div className="composer-head">
          <span className="composer-note">{props.lines} · sent when you send this chunk</span>
        </div>
      }
      initial={props.initial}
      placeholder="What should change?"
      saveLabel="Add comment"
      leading={(body) => (
        <button className="ask-in-chat" title="Ask the agent about these lines in the chat" onClick={() => props.onAskInChat(body)}>
          <ChatIcon />
          Ask in chat
        </button>
      )}
      onChange={props.onChange}
      onSave={props.onSave}
      onCancel={props.onCancel}
    />
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path
        d="M2.5 3.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6l-2.5 2v-2h0a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Composer(props: {
  label?: string;
  header?: ReactNode;
  /** Shown left of Cancel, with the text typed so far. */
  leading?: (body: string) => ReactNode;
  /** The textarea takes focus again whenever this changes. */
  focusKey?: string;
  initial?: string;
  saveLabel?: string;
  placeholder?: string;
  onChange?: (body: string) => void;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(props.initial ?? "");
  const change = (next: string) => {
    setBody(next);
    props.onChange?.(next);
  };
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), [props.focusKey]);

  const save = () => {
    if (body.trim()) props.onSave(body.trim());
  };

  return (
    <div className="composer">
      {props.header ?? (props.label && <div className="composer-label">{props.label}</div>)}
      <textarea
        ref={ref}
        value={body}
        rows={3}
        aria-label={props.label ?? props.placeholder ?? "Comment"}
        placeholder={props.placeholder ?? "Leave a comment for the agent"}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          if (e.key === "Escape") props.onCancel();
        }}
      />
      <div className="row">
        {props.leading?.(body.trim())}
        <span className="spacer" />
        <button onClick={props.onCancel}>Cancel</button>
        <button className="primary" disabled={!body.trim()} onClick={save}>
          {props.saveLabel ?? "Add comment"}
          <kbd>⌘</kbd>
          <kbd>↵</kbd>
        </button>
      </div>
    </div>
  );
}
