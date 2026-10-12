import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { isResolved, unsentCount } from "../src/review";
import { LOST_LABEL } from "./CommentsPanel";
import type { ChatCode, Verdict, ViewChunk, ViewComment, ViewState } from "../src/types";
import { useActions } from "./actions";
import { ChatPanel } from "./ChatPanel";
import { ChunkView, type Compare } from "./ChunkView";
import { ASK_IN_CHAT_EVENT, type AskInChat, focusLines } from "./codeLines";
import { OVERVIEW_INDEX, OverviewView } from "./OverviewView";
import { CommentsPanel } from "./CommentsPanel";
import { Dock, type DockTab } from "./Dock";
import { useHighlightNeighbours } from "./diffCache";
import type { DiffStyle } from "./FileBlock";
import { usePref } from "./prefs";
import { OptimisticSaveContext, useReviewState } from "./reviewState";
import { Sidebar } from "./Sidebar";
import { SubmitDialog } from "./SubmitDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { AgentListeningContext, FOCUS_THREAD_EVENT } from "./Thread";
import { Toast, type ToastOptions, useToast } from "./Toast";
import { Topbar } from "./Topbar";
import { plural } from "./text";
import { UNDO_MS, type Undoable, UndoContext, undoWindow } from "./undo";

type Panel = "none" | "submit" | "keys";

export function App() {
  const toast = useToast();
  const { state, loadError, online, optimisticSave } = useReviewState((message) =>
    toast.show(message, { error: true }),
  );
  const { undoable, undoLast } = useUndo(toast.show, toast.replace);

  if (!state) return <LoadingScreen error={loadError} />;
  return (
    <OptimisticSaveContext.Provider value={optimisticSave}>
      <UndoContext.Provider value={undoable}>
        <AgentListeningContext.Provider value={state.agentListening}>
          <ReviewPage state={state} online={online} showToast={toast.show} undoLast={undoLast} />
        </AgentListeningContext.Provider>
      </UndoContext.Provider>
      <Toast toast={toast.toast} onHover={(on) => toast.hold("hover", on)} />
    </OptimisticSaveContext.Provider>
  );
}

/** Sends and deletes wait a few seconds behind an Undo toast; `u` takes back the latest one. */
function useUndo(show: (message: string, options?: ToastOptions) => number, replace: (id: number, message: string) => void) {
  const latest = useRef<(() => void) | null>(null);

  const undoable = useCallback<Undoable>(
    (message, act, doneMessage) => {
      const { wait, undo } = undoWindow();
      const takeBack = () => {
        if (undo()) show("Undone.");
        if (latest.current === takeBack) latest.current = null;
      };
      latest.current = takeBack;
      const id = show(message, { action: { label: "Undo", key: "u", onClick: takeBack }, ms: UNDO_MS });
      act(wait).then((ok) => {
        if (latest.current === takeBack) latest.current = null;
        if (ok && doneMessage) replace(id, doneMessage);
      });
    },
    [show, replace],
  );

  const undoLast = useCallback(() => latest.current?.(), []);
  return { undoable, undoLast };
}

function ReviewPage(props: {
  state: ViewState;
  online: boolean;
  showToast: (message: string, options?: ToastOptions) => number;
  undoLast: () => void;
}) {
  const { state, showToast } = props;
  const undoable = useContext(UndoContext);
  const chunks = state.chunks;
  const actions = useActions();
  const mainRef = useRef<HTMLElement>(null);

  const [diffStyle, setDiffStyle] = usePref<DiffStyle>("stackdiff.style", "unified");
  const [visual, setVisual] = usePref<"open" | "closed">("stackdiff.visual", "open");
  const toggleVisual = () => setVisual(visual === "open" ? "closed" : "open");
  const [compare, setCompare] = usePref<Compare>("stackdiff.compareTo", "review");
  const toggleCompare = () => setCompare(compare === "review" ? "base" : "review");
  const [panel, setPanel] = useState<Panel>("none");
  const togglePanel = (p: Panel) => setPanel((current) => (current === p ? "none" : p));
  const dock = useDock();

  const hasOverview = state.overview.trim() !== "";
  const { index, chunk, go } = useCurrentChunk(chunks, hasOverview, mainRef);
  const jumpTo = useJumpToThread(chunks, index, go);
  useHighlightNeighbours(chunks, index);

  const threads = state.comments;
  const unsent = unsentCount(threads);
  const openThreads = threads.filter((t) => !isResolved(t));
  const approvedCount = chunks.filter((c) => c.reviewed).length;
  const allApproved = chunks.length > 0 && approvedCount === chunks.length;
  const openThreadsByChunk = countByChunk(openThreads);

  const chunkUnsent = chunk ? unsentCount(threads.filter((t) => t.chunkKey === chunk.key)) : 0;
  const sendChunk = () => {
    if (!chunk || chunkUnsent === 0) return;
    const count = plural(chunkUnsent, "message");
    undoable(`Sending ${count}…`, (wait) => actions.sendChunk(chunk, wait), `${count} sent to the agent.`);
    go(index + 1);
  };
  useAnnounceChangedChunks(chunks, showToast);
  const unreadChat = useUnreadChat(state.chat, dock.open && dock.tab === "chat");
  const chatDraft = useChatDraft(() => dock.show("chat", "pointer"));
  const jumpToCode = (code: ChatCode) => {
    const i = chunks.findIndex((c) => c.files.some((f) => f.path === code.file && inRanges(f.ranges[code.side], code.endLine)));
    if (i === -1) return showToast("Those lines are no longer in the diff.");
    if (i !== index) go(i);
    requestAnimationFrame(() => focusLines(code));
  };

  const failedNote = useRef("");
  const sendReview = (verdict: Verdict, note: string) => {
    setPanel("none");
    showToast(verdict === "approve" ? "Approved. Sent to the agent." : "Review sent to the agent.");
    actions.submitReview(verdict, note).then((ok) => {
      failedNote.current = ok ? "" : note;
      if (!ok) setPanel("submit");
    });
  };

  useShortcuts({
    j: () => go(index + 1),
    k: () => go(index - 1),
    a: () => {
      if (!chunk) return;
      actions.setReviewed(chunk, !chunk.reviewed);
      if (!chunk.reviewed) go(index + 1);
    },
    s: sendChunk,
    v: toggleVisual,
    f: toggleCompare,
    o: () => go(OVERVIEW_INDEX),
    u: props.undoLast,
    "]": () => dock.toggle("key"),
    t: () => dock.show("threads", "key"),
    c: () => dock.show("chat", "key"),
    "?": () => togglePanel("keys"),
    Escape: () => (panel !== "none" ? setPanel("none") : dock.close("key")),
  });
  useChunkNumberKeys(state.chunks.length, go);

  return (
    <div className="app">
      <Topbar
        branch={state.branch}
        base={state.base}
        online={props.online}
        diffStyle={diffStyle}
        onDiffStyle={setDiffStyle}
        unsentMessages={unsent}
        unsentInChunk={chunkUnsent}
        dockOpen={dock.open}
        unreadChat={dock.open && dock.tab === "chat" ? 0 : unreadChat}
        onToggleDock={() => dock.toggle("pointer")}
        onSubmit={() => setPanel("submit")}
      />

      <div className="body">
        <Sidebar
          state={state}
          currentIndex={index}
          openThreadsByChunk={openThreadsByChunk}
          onSelect={go}
          onSetReviewed={actions.setReviewed}
        />

        <main className="main" ref={mainRef}>
          <Banners state={state} />
          {index === OVERVIEW_INDEX ? (
            <OverviewView state={state} onGo={go} />
          ) : chunk ? (
            <ChunkView
              chunk={chunk}
              index={index}
              total={chunks.length}
              threads={threads.filter((t) => t.chunkKey === chunk.key)}
              diffStyle={diffStyle}
              visualOpen={visual === "open"}
              onToggleVisual={toggleVisual}
              compare={compare}
              onToggleCompare={toggleCompare}
              base={state.base}
              hasOverview={hasOverview}
              onGo={go}
              onSetReviewed={actions.setReviewed}
              unsent={chunkUnsent}
              openThreads={openThreadsByChunk.get(chunk.key) ?? 0}
              onSend={sendChunk}
            />
          ) : (
            <Empty title="Nothing to review">
              No changes against <code>{state.base}</code> yet. This page updates when the agent edits files.
            </Empty>
          )}
          {allApproved && (
            <div className="done-note">
              <span className="done-mark" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path
                    className="draw"
                    pathLength={1}
                    d="M3 7.5 5.75 10 11 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="done-text">
                All {plural(chunks.length, "chunk")} approved.
                {unsent > 0 && ` ${plural(unsent, "unsent message")}.`}
              </span>
              <button
                className="primary"
                onClick={() => (unsent > 0 ? setPanel("submit") : sendReview("approve", ""))}
              >
                Approve & finish
              </button>
            </div>
          )}
        </main>

        <Dock
          open={dock.open}
          tab={dock.tab}
          instant={dock.instant}
          openThreads={openThreads.length}
          unreadChat={unreadChat}
          onTab={(tab) => dock.show(tab, "pointer")}
          onClose={() => dock.close("pointer")}
          threads={<CommentsPanel chunks={chunks} currentIndex={index} threads={threads} onJump={jumpTo} />}
          chat={
            <ChatPanel
              chat={state.chat}
              chunk={index === OVERVIEW_INDEX || !chunk ? null : { title: chunk.title }}
              focusKey={dock.chatFocus}
              draft={chatDraft.draft}
              onDropCode={() => chatDraft.setCode(null)}
              onRestoreCode={chatDraft.setCode}
              onJumpToCode={jumpToCode}
            />
          }
        />
      </div>

      {panel === "keys" && <ShortcutsDialog onClose={() => setPanel("none")} />}

      {panel === "submit" && (
        <SubmitDialog
          unsentMessages={unsent}
          unsentByChunk={unsentByChunk(chunks, threads)}
          unapprovedChunks={chunks.length - approvedCount}
          initialNote={failedNote.current}
          onSend={sendReview}
          onClose={() => setPanel("none")}
        />
      )}
    </div>
  );
}

function Banners({ state }: { state: ViewState }) {
  return (
    <>
      {state.planError && (
        <div className="banner warn">
          <span>plan.json is invalid: {state.planError}</span>
        </div>
      )}
      {!state.hasPlan && !state.planError && state.chunks.length > 0 && (
        <div className="banner">
          <span>
            No plan yet, so each file is its own chunk. Ask the agent to write one.
          </span>
        </div>
      )}
      {state.waitingReviews > 0 && (
        <div className="banner banner-live">
          <span className="dot" aria-hidden />
          <span>
            Review sent. Waiting for the agent to pick it up with <code>stackdiff wait</code>.
          </span>
        </div>
      )}
    </>
  );
}

function LoadingScreen({ error }: { error: string | null }) {
  if (!error) return <div className="center muted loading">Loading diff…</div>;
  return (
    <Empty title="Cannot reach the stackdiff server">
      {error}. Run <code>stackdiff open</code> in the repo, then reload.
    </Empty>
  );
}

function Empty(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="center">
      <div className="empty">
        <b>{props.title}</b>
        <span className="muted">{props.children}</span>
      </div>
    </div>
  );
}

function unsentByChunk(chunks: ViewChunk[], threads: ViewComment[]) {
  const groups = chunks.map((chunk, i) => ({
    label: `${i + 1}. ${chunk.title}`,
    count: unsentCount(threads.filter((t) => t.chunkKey === chunk.key)),
  }));
  groups.push({ label: LOST_LABEL, count: unsentCount(threads.filter((t) => t.chunkKey === null)) });
  return groups.filter((g) => g.count > 0);
}

/** Says so when the agent changes a chunk you approved, since that clears the approval. */
function useAnnounceChangedChunks(chunks: ViewChunk[], show: (message: string) => void) {
  const announced = useRef(new Set<string>());
  const changed = chunks.flatMap((c, i) => (c.changedSinceApproval ? [{ key: c.key, num: i + 1 }] : []));
  const changedKeys = changed.map((c) => c.key).join("\0");
  const latest = useRef(changed);
  latest.current = changed;
  useEffect(() => {
    const fresh = latest.current.filter((c) => !announced.current.has(c.key));
    announced.current = new Set(latest.current.map((c) => c.key));
    if (fresh.length === 0) return;
    const which = `${fresh.length === 1 ? "chunk" : "chunks"} ${fresh.map((c) => c.num).join(", ")}`;
    show(`The agent changed ${which} after you approved. Check and approve again.`);
  }, [changedKeys, show]);
}

/** Lines picked with "Ask in chat" wait above the chat box until the next message takes them. */
function useChatDraft(openChat: () => void) {
  const [draft, setDraft] = useState<{ code: ChatCode | null; text: string; key: number }>({ code: null, text: "", key: 0 });
  const latest = useRef(openChat);
  latest.current = openChat;
  useEffect(() => {
    const onAsk = (e: Event) => {
      const { code, body } = (e as CustomEvent<AskInChat>).detail;
      setDraft((d) => ({ code, text: body, key: d.key + 1 }));
      latest.current();
    };
    addEventListener(ASK_IN_CHAT_EVENT, onAsk);
    return () => removeEventListener(ASK_IN_CHAT_EVENT, onAsk);
  }, []);
  const setCode = (code: ChatCode | null) => setDraft((d) => ({ ...d, code, text: "" }));
  return { draft, setCode };
}

function inRanges(ranges: [number, number][], line: number) {
  return ranges.some(([a, b]) => line >= a && line <= b);
}

type Via = "key" | "pointer";

/** The right sidebar's state. `t`/`c` on the tab already shown close it, like `]`. */
function useDock() {
  const [open, setOpen] = usePref<"open" | "closed">("stackdiff.dock", "closed");
  const [tab, setTab] = usePref<DockTab>("stackdiff.dockTab", "threads");
  const [instant, setInstant] = useState(true);
  const [chatFocus, setChatFocus] = useState(0);
  const isOpen = open === "open";

  const close = (via: Via) => {
    setInstant(via === "key");
    setOpen("closed");
  };
  const show = (next: DockTab, via: Via) => {
    if (via === "key" && isOpen && tab === next) return close(via);
    setInstant(via === "key");
    setOpen("open");
    setTab(next);
    if (next === "chat") setChatFocus((n) => n + 1);
  };
  const toggle = (via: Via) => (isOpen ? close(via) : show(tab, via));

  return { open: isOpen, tab, instant, chatFocus, show, close, toggle };
}

const chatNumber = (id: string) => Number(id.split(".")[1]) || 0;

/** Agent replies that came in while the chat was not on screen. Kept across reloads; a first visit has read everything. */
function useUnreadChat(chat: ViewState["chat"], open: boolean): number {
  const newest = Math.max(0, ...chat.map((m) => chatNumber(m.id)));
  const [read, setRead] = usePref<string>("stackdiff.chatRead", String(newest));
  const readUpTo = Number(read);
  // Store the first visit's mark too, or a reload would count replies since then as read.
  useEffect(() => setRead(read), []);
  useEffect(() => {
    // A newer number than any message means the review started over.
    if ((open && readUpTo < newest) || readUpTo > newest) setRead(String(newest));
  }, [open, newest, readUpTo]);
  return chat.filter((m) => m.author === "agent" && chatNumber(m.id) > readUpTo).length;
}

function countByChunk(threads: ViewComment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of threads) if (t.chunkKey) counts.set(t.chunkKey, (counts.get(t.chunkKey) ?? 0) + 1);
  return counts;
}

const OVERVIEW = Symbol("overview");
type Selected = string | typeof OVERVIEW | null;

function useCurrentChunk(chunks: ViewChunk[], hasOverview: boolean, mainRef: React.RefObject<HTMLElement | null>) {
  const [selected, setSelected] = useState<Selected>(readHash);
  const lastIndex = useRef(0);

  useEffect(() => {
    const onHashChange = () => setSelected(readHash());
    addEventListener("hashchange", onHashChange);
    return () => removeEventListener("hashchange", onHashChange);
  }, []);

  const firstVisit = selected === null;
  let index = chunks.findIndex((c) => c.key === selected);
  if (hasOverview && (selected === OVERVIEW || firstVisit)) index = OVERVIEW_INDEX;
  else if (index === -1) index = Math.min(Math.max(lastIndex.current, 0), Math.max(chunks.length - 1, 0));
  lastIndex.current = index;

  const go = useCallback(
    (i: number) => {
      const target = i === OVERVIEW_INDEX && hasOverview ? OVERVIEW : chunks[i]?.key;
      if (target === undefined) return;
      const hash = target === OVERVIEW ? "#overview" : `#chunk=${encodeURIComponent(target)}`;
      history.replaceState(null, "", hash);
      setSelected(target);
      mainRef.current?.scrollTo({ top: 0 });
    },
    [chunks, hasOverview, mainRef],
  );

  return { index, chunk: chunks[index] as ViewChunk | undefined, go };
}

function readHash(): Selected {
  if (location.hash === "#overview") return OVERVIEW;
  const match = location.hash.match(/^#chunk=(.*)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

const MAX_FRAMES_TO_WAIT_FOR_THREAD = 120;

function scrollToCenter(element: HTMLElement) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
}

function replayAnimation(element: HTMLElement, className: string) {
  element.classList.remove(className);
  element.getBoundingClientRect();
  element.classList.add(className);
}

function useJumpToThread(chunks: ViewChunk[], currentIndex: number, go: (index: number) => void) {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    dispatchEvent(new CustomEvent(FOCUS_THREAD_EVENT, { detail: target }));
    let frame = 0;
    let framesWaited = 0;
    const scrollToThreadOnceRendered = () => {
      const thread = document.querySelector<HTMLElement>(`[data-thread-id="${target}"]`);
      if (thread) {
        scrollToCenter(thread);
        replayAnimation(thread, "flash");
        setTarget(null);
      } else if (framesWaited++ < MAX_FRAMES_TO_WAIT_FOR_THREAD) {
        frame = requestAnimationFrame(scrollToThreadOnceRendered);
      } else {
        setTarget(null);
      }
    };
    frame = requestAnimationFrame(scrollToThreadOnceRendered);
    return () => cancelAnimationFrame(frame);
  }, [target, currentIndex]);

  return (thread: ViewComment) => {
    const i = chunks.findIndex((c) => c.key === thread.chunkKey);
    if (i === -1) return;
    if (i !== currentIndex) go(i);
    setTarget(thread.id);
  };
}

function useShortcuts(handlers: Record<string, () => void>) {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest<HTMLElement>("textarea, input");
      if (typing) {
        // Esc leaves the box, so the next key is a shortcut again. What was typed stays.
        if (e.key === "Escape") typing.blur();
        return;
      }
      // Some layouts need Option/AltGr for symbols like "]" (German: Option+6), so only letters refuse Alt.
      const altLetter = e.altKey && /^[a-z]$/i.test(e.key);
      if (e.metaKey || e.ctrlKey || altLetter) return;
      const handler = latest.current[e.key];
      if (!handler) return;
      // A shortcut that focuses a text box must not type its own key into it.
      e.preventDefault();
      handler();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

const NEXT_DIGIT_WAIT_MS = 250;

/** Typing a chunk's number opens it. A digit that could start a longer number waits briefly for the next one. */
function useChunkNumberKeys(count: number, go: (index: number) => void) {
  const latest = useRef({ count, go });
  latest.current = { count, go };
  useEffect(() => {
    let typed = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const jump = () => {
      const n = Number(typed);
      typed = "";
      if (n >= 1) latest.current.go(n - 1);
    };
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("textarea, input");
      if (typing || e.metaKey || e.ctrlKey || e.altKey || !/^[0-9]$/.test(e.key)) return;
      clearTimeout(timer);
      const { count } = latest.current;
      typed = Number(typed + e.key) <= count ? typed + e.key : e.key;
      if (Number(typed) * 10 <= count) timer = setTimeout(jump, NEXT_DIGIT_WAIT_MS);
      else jump();
    };
    addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      removeEventListener("keydown", onKey);
    };
  }, []);
}
