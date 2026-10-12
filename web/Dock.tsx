import { type ReactNode, useRef } from "react";
import { usePref } from "./prefs";

export type DockTab = "threads" | "chat";

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;
/** The diff keeps at least this much room, whatever the sidebar asks for. */
const MIN_MAIN_WIDTH = 480;
const KEY_STEP = 16;
const BIG_KEY_STEP = 64;
const DOUBLE_CLICK_MS = 400;

function clampWidth(width: number) {
  const roomLeft = window.innerWidth - MIN_MAIN_WIDTH;
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, MAX_WIDTH, roomLeft)));
}

/** The right sidebar: threads and chat as two tabs. Both stay mounted, so a chat draft survives a switch. */
export function Dock(props: {
  open: boolean;
  tab: DockTab;
  /** Opened by a key: show at once, since keys repeat all day and motion would only slow them. */
  instant: boolean;
  openThreads: number;
  unreadChat: number;
  onTab: (tab: DockTab) => void;
  onClose: () => void;
  threads: ReactNode;
  chat: ReactNode;
}) {
  const [savedWidth, setSavedWidth] = usePref("stackdiff.dockWidth", String(DEFAULT_WIDTH));
  const width = clampWidth(Number(savedWidth) || DEFAULT_WIDTH);
  const dockRef = useRef<HTMLElement>(null);

  const tab = (id: DockTab, label: string, key: string, badge: ReactNode) => (
    <button
      role="tab"
      id={`dock-tab-${id}`}
      aria-selected={props.tab === id}
      aria-controls={`dock-panel-${id}`}
      tabIndex={props.tab === id ? 0 : -1}
      title={`${label} (${key})`}
      onClick={() => props.onTab(id)}
    >
      {label}
      {badge}
    </button>
  );

  return (
    <aside
      ref={dockRef}
      className="dock"
      style={{ width }}
      hidden={!props.open}
      data-instant={props.instant || undefined}
      aria-label="Sidebar"
    >
      <ResizeHandle
        width={width}
        onPreview={(w) => dockRef.current?.style.setProperty("width", `${clampWidth(w)}px`)}
        onCommit={(w) => setSavedWidth(String(clampWidth(w)))}
      />
      <div className="dock-head">
        <div
          className="dock-tabs"
          role="tablist"
          aria-label="Sidebar"
          data-value={props.tab}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            props.onTab(props.tab === "threads" ? "chat" : "threads");
          }}
        >
          <span className="dock-thumb" aria-hidden />
          {tab("threads", "Threads", "t", props.openThreads > 0 && <span className="tab-count">{props.openThreads}</span>)}
          {tab("chat", "Chat", "c", props.unreadChat > 0 && <span className="tab-dot" aria-label={`${props.unreadChat} new`} />)}
        </div>
        <button className="icon dock-close" aria-label="Close sidebar" title="Close (])" onClick={props.onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M3.5 3.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="dock-panel" role="tabpanel" id="dock-panel-threads" aria-labelledby="dock-tab-threads" hidden={props.tab !== "threads"}>
        {props.threads}
      </div>
      <div className="dock-panel" role="tabpanel" id="dock-panel-chat" aria-labelledby="dock-tab-chat" hidden={props.tab !== "chat"}>
        {props.chat}
      </div>
    </aside>
  );
}

/**
 * The sidebar's left edge. Dragging sets the width on the element directly and saves it on release,
 * so React does not re-render the diff on every pointer move.
 */
function ResizeHandle(props: { width: number; onPreview: (width: number) => void; onCommit: (width: number) => void }) {
  const drag = useRef<{ startX: number; startWidth: number; width: number; moved: boolean } | null>(null);
  // Pointer capture keeps Chrome from counting clicks (no dblclick, detail stays 1), so time them here.
  const lastClick = useRef({ at: 0, moved: false });

  const end = () => {
    if (!drag.current) return;
    props.onCommit(drag.current.width);
    lastClick.current.moved = drag.current.moved;
    drag.current = null;
    document.documentElement.classList.remove("resizing-dock");
  };

  return (
    <div
      className="dock-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={props.width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: props.width, width: props.width, moved: false };
        document.documentElement.classList.add("resizing-dock");
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        // The handle is on the left edge: moving left makes the sidebar wider.
        drag.current.width = clampWidth(drag.current.startWidth + drag.current.startX - e.clientX);
        drag.current.moved ||= drag.current.width !== drag.current.startWidth;
        props.onPreview(drag.current.width);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onClick={(e) => {
        const last = lastClick.current;
        const isDouble = !last.moved && e.timeStamp - last.at < DOUBLE_CLICK_MS;
        lastClick.current = { at: isDouble ? 0 : e.timeStamp, moved: false };
        if (!isDouble) return;
        props.onPreview(DEFAULT_WIDTH);
        props.onCommit(DEFAULT_WIDTH);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const step = (e.shiftKey ? BIG_KEY_STEP : KEY_STEP) * (e.key === "ArrowLeft" ? 1 : -1);
        props.onCommit(props.width + step);
      }}
    />
  );
}

export function DockIcon(props: { open: boolean; unread: number; onToggle: () => void }) {
  return (
    <button
      className={`icon dock-toggle ${props.open ? "on" : ""}`}
      aria-pressed={props.open}
      aria-label={props.unread ? `Sidebar, ${props.unread} unread chat ${props.unread === 1 ? "reply" : "replies"}` : "Sidebar"}
      title="Sidebar (])"
      onClick={props.onToggle}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect className="dock-toggle-fill" x="10" y="2.5" width="3.5" height="11" rx="1" />
        <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 2v12" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      {props.unread > 0 && (
        <span className="dock-badge" aria-hidden>
          {props.unread > 9 ? "9+" : props.unread}
        </span>
      )}
    </button>
  );
}
