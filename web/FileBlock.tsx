import type {
  DiffLineAnnotation,
  FileDiffLoadedFiles,
  FileDiffOptions,
  SelectedLineRange,
} from "@pierre/diffs/react";
import { FileDiff } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SinceFile, Side, ViewChunk, ViewComment, ViewFile } from "../src/types";
import { useActions } from "./actions";
import { fileDiffFor } from "./diffCache";
import { api } from "./api";
import { askInChat, FOCUS_LINES_EVENT, snippetFromPatch, takePendingFocus } from "./codeLines";
import { stableKey } from "./tempIds";
import { lineLabel } from "./text";
import { FOCUS_THREAD_EVENT, NewThreadComposer, ThreadCard } from "./Thread";

export type DiffStyle = "unified" | "split";

interface NewCommentLines {
  side: Side;
  start: number;
  end: number;
  body?: string;
}


const STICKY_FILE_HEADER_CSS = `
[data-diffs-header] { background: var(--bg-subtle); border-bottom: 1px solid var(--border); }
[data-diffs-header][data-sticky] { top: calc(-1 * var(--main-pad-top, 0px)); }
[data-diffs-header] [data-title] { font-weight: 500; font-size: 13px; }
[data-diffs-header] [data-metadata] { font-family: var(--mono); font-size: 12px; font-variant-numeric: tabular-nums; }
`;

const EXPAND_STEP = 20;

/** The open new-thread box per file, outside React: a new plan remounts every FileBlock and must not drop what the user typed. */
const drafts = new Map<string, NewCommentLines>();

function useDraft(path: string) {
  const [draft, setDraftState] = useState(() => drafts.get(path) ?? null);
  const setDraft = useCallback(
    (next: NewCommentLines | null) => {
      if (next) drafts.set(path, next);
      else drafts.delete(path);
      setDraftState(next);
    },
    [path],
  );
  // Typing goes to the map only: re-rendering the diff on every key is slow.
  const setBody = (body: string) => {
    const current = drafts.get(path);
    if (current) drafts.set(path, { ...current, body });
  };
  return [draft, setDraft, setBody] as const;
}

async function loadBothSides(path: string, oldPath: string | null, since?: string): Promise<FileDiffLoadedFiles> {
  const query = `path=${encodeURIComponent(path)}${since === undefined ? "" : `&since=${encodeURIComponent(since)}`}`;
  const sides = await api<{ old: string; new: string }>(`/api/contents?${query}`);
  return { oldFile: { name: oldPath ?? path, contents: sides.old }, newFile: { name: path, contents: sides.new } };
}

export function FileBlock(props: {
  file: ViewFile;
  chunk: ViewChunk;
  threads: ViewComment[];
  diffStyle: DiffStyle;
  /** Set to show the file against the code the user last reviewed instead of the base. */
  since?: SinceFile;
}) {
  const { file, chunk, diffStyle, since } = props;
  // Against the last review, the left side is the reviewed copy: base line numbers mean nothing there.
  const threads = since ? props.threads.filter((t) => t.side === "additions") : props.threads;
  const patch = since ? since.patch : file.patch;
  const expandable = since ? since.expandable : file.expandable;
  const againstReview = since !== undefined;
  const actions = useActions();
  const [newComment, setNewComment, setNewCommentBody] = useDraft(file.path);
  const [collapsed, setCollapsed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  useExpandWhenThreadFocused(threads, () => setCollapsed(false));
  const focused = useFocusLines(file.path, sectionRef, () => setCollapsed(false));

  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      diffStyle,
      collapsed,
      themeType: "system",
      overflow: "wrap",
      lineDiffType: "word-alt",
      // A file split across chunks hides other chunks' changes between its
      // hunks, so "N unmodified lines" would lie there: show a plain divider.
      hunkSeparators: expandable ? "line-info" : "simple",
      expansionLineCount: EXPAND_STEP,
      loadDiffFiles: expandable
        ? () => loadBothSides(file.path, againstReview ? null : file.oldPath, againstReview ? chunk.key : undefined)
        : undefined,
      enableGutterUtility: true,
      lineHoverHighlight: "both",
      stickyHeader: true,
      unsafeCSS: STICKY_FILE_HEADER_CSS,
      onGutterUtilityClick: (range: SelectedLineRange) => {
        const side = range.endSide ?? range.side ?? "additions";
        if (againstReview && side === "deletions") return;
        setNewComment({ side, start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) });
      },
    }),
    [diffStyle, collapsed, expandable, file.path, file.oldPath, setNewComment, againstReview, chunk.key],
  );

  const annotations = useLineAnnotations(threads, newComment);
  useRestoreHoverButtonAfterRerender(sectionRef, [annotations, diffStyle]);

  const save = (lines: NewCommentLines, body: string) => {
    setNewComment(null);
    const comment = { file: file.path, side: lines.side, startLine: lines.start, endLine: lines.end, body, kind: "change" as const };
    actions.addComment(comment, chunk).then((ok) => !ok && setNewComment({ ...lines, body }));
  };

  const moveToChat = (lines: NewCommentLines, body: string) => {
    setNewComment(null);
    const snippet = snippetFromPatch(patch, lines.side, lines.start, lines.end);
    askInChat({ code: { file: file.path, side: lines.side, startLine: lines.start, endLine: lines.end, snippet }, body });
  };

  if (!patch) {
    return (
      <section className="file file-note" data-file={file.path}>
        <header>
          <span className="path">{file.path}</span>
          {!since && <span className={`status status-${file.status}`}>{file.status}</span>}
        </header>
        <p>{since ? "No changes here since then." : file.note}</p>
      </section>
    );
  }

  return (
    <section className="file" ref={sectionRef} data-file={file.path}>
      {since?.joined && <div className="since-note">New in this chunk</div>}
      <FileDiff<undefined, undefined>
        fileDiff={fileDiffFor(patch)}
        options={options}
        renderHeaderPrefix={() => (
          <button
            className="file-toggle"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${file.path}`}
            title={collapsed ? "Expand file" : "Collapse file"}
            onClick={() => setCollapsed(!collapsed)}
          >
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
        )}
        lineAnnotations={annotations}
        selectedLines={selectionFor(newComment ?? focused)}
        // Reads the threads from this render, not from the annotation, so new content needs no new annotations.
        renderAnnotation={({ side, lineNumber }) => {
          const here = (s: Side, line: number) => s === side && line === lineNumber;
          const draft = newComment && here(newComment.side, newComment.end) ? newComment : null;
          return (
            <div className="thread">
              {threads
                .filter((t) => here(t.side, t.endLine))
                .map((t) => (
                  <ThreadCard key={stableKey(t.id)} thread={t} />
                ))}
              {draft && (
                <NewThreadComposer
                  lines={lineLabel(draft.start, draft.end)}
                  initial={draft.body}
                  onChange={setNewCommentBody}
                  onSave={(body) => save(draft, body)}
                  onAskInChat={(body) => moveToChat(draft, body)}
                  onCancel={() => setNewComment(null)}
                />
              )}
            </div>
          );
        }}
      />
    </section>
  );
}

const FOCUS_MARK_MS = 2000;
const MAX_FRAMES_TO_WAIT_FOR_LINE = 120;

/** Scrolls to lines a chat message is about and marks them for a moment. */
function useFocusLines(path: string, sectionRef: React.RefObject<HTMLElement | null>, expand: () => void) {
  const [focused, setFocused] = useState<NewCommentLines | null>(null);
  const latest = useRef(expand);
  latest.current = expand;

  useEffect(() => {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout>;
    const focus = () => {
      const code = takePendingFocus(path);
      if (!code) return;
      latest.current();
      setFocused({ side: code.side, start: code.startLine, end: code.endLine });
      clearTimeout(timer);
      timer = setTimeout(() => setFocused(null), FOCUS_MARK_MS);
      let framesWaited = 0;
      const scrollOnceRendered = () => {
        const line = findLine(sectionRef.current, code.side, code.startLine);
        if (line) scrollToCenter(line);
        else if (framesWaited++ < MAX_FRAMES_TO_WAIT_FOR_LINE) frame = requestAnimationFrame(scrollOnceRendered);
      };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scrollOnceRendered);
    };
    focus();
    addEventListener(FOCUS_LINES_EVENT, focus);
    return () => {
      removeEventListener(FOCUS_LINES_EVENT, focus);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [path, sectionRef]);

  return focused;
}

function findLine(section: HTMLElement | null, side: Side, line: number): HTMLElement | null {
  const lines = section?.querySelector("diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>(`[data-line="${line}"]`);
  const onSide = [...(lines ?? [])].find((el) => {
    const isDeletion = (el.dataset.lineType ?? "").includes("deletion");
    return side === "deletions" ? isDeletion : !isDeletion;
  });
  return onSide ?? null;
}

function scrollToCenter(element: HTMLElement) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
}

/** A jump to a thread (from the comments panel) must not land in a collapsed file. */
function useExpandWhenThreadFocused(threads: ViewComment[], expand: () => void) {
  const latest = useRef({ threads, expand });
  latest.current = { threads, expand };
  useEffect(() => {
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (latest.current.threads.some((t) => t.id === id)) latest.current.expand();
    };
    addEventListener(FOCUS_THREAD_EVENT, onFocus);
    return () => removeEventListener(FOCUS_THREAD_EVENT, onFocus);
  }, []);
}

function selectionFor(newComment: NewCommentLines | null): SelectedLineRange | null {
  if (!newComment) return null;
  return { start: newComment.start, end: newComment.end, side: newComment.side, endSide: newComment.side };
}

/**
 * The lines that hold a thread or the new-thread box. A new array makes the diff library redraw the whole file,
 * so it changes only when a line gains or loses one, not when a thread's text, status or id changes.
 */
function useLineAnnotations(threads: ViewComment[], newComment: NewCommentLines | null) {
  const lines = threads.map((t) => `${t.side}:${t.endLine}`);
  if (newComment) lines.push(`${newComment.side}:${newComment.end}`);
  const linesKey = [...new Set(lines)].sort().join(",");
  return useMemo(
    () =>
      linesKey === ""
        ? []
        : linesKey.split(",").map((key): DiffLineAnnotation<undefined> => {
            const [side, line] = key.split(":");
            return { side: side as Side, lineNumber: Number(line) };
          }),
    [linesKey],
  );
}

const lastPointer = { x: -1, y: -1 };
window.addEventListener("pointermove", (e) => ((lastPointer.x = e.clientX), (lastPointer.y = e.clientY)), {
  capture: true,
  passive: true,
});

function useRestoreHoverButtonAfterRerender(
  sectionRef: React.RefObject<HTMLElement | null>,
  rerenderTriggers: unknown[],
) {
  useEffect(() => afterNextPaint(() => replayHoverAtLastPointer(sectionRef.current)), rerenderTriggers);
}

function afterNextPaint(callback: () => void): () => void {
  let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(callback)));
  return () => cancelAnimationFrame(frame);
}

function replayHoverAtLastPointer(section: HTMLElement | null) {
  const diffRoot = section?.querySelector("diffs-container")?.shadowRoot;
  const code = diffRoot?.querySelector("pre");
  const lineUnderPointer = diffRoot?.elementFromPoint(lastPointer.x, lastPointer.y);
  if (!code || !lineUnderPointer || !code.contains(lineUnderPointer)) return;
  forgetHoveredLine(code);
  lineUnderPointer.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerType: "mouse",
      clientX: lastPointer.x,
      clientY: lastPointer.y,
      bubbles: true,
      composed: true,
    }),
  );
}

function forgetHoveredLine(code: HTMLElement) {
  code.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
}
