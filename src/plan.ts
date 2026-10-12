import { createHash } from "node:crypto";
import { hunkLines, sliceHunk } from "./git";
import type {
  Comment,
  DiffFile,
  DiffHunk,
  LineRanges,
  Plan,
  ReviewState,
  Side,
  ViewChunk,
  ViewComment,
  ViewFile,
} from "./types";

export const UNPLANNED_TITLE = "Not in plan";

type HunkIndex = ReturnType<typeof indexHunks>;

function indexHunks(files: DiffFile[]) {
  const byId = new Map<string, DiffHunk>();
  const byFile = new Map<string, DiffFile>();
  const lineCount = new Map<string, number>();
  for (const f of files) {
    byFile.set(f.path, f);
    for (const h of f.hunks) {
      byId.set(h.id, h);
      lineCount.set(h.id, [...hunkLines(h)].length);
    }
  }
  return { byId, byFile, lineCount };
}

/** Line slots a hunk takes in a plan. A hunk with no text (binary, rename) takes one. */
function slots(hunk: DiffHunk, idx: HunkIndex): number {
  return Math.max(1, idx.lineCount.get(hunk.id)!);
}

interface Piece {
  hunk: DiffHunk;
  from: number;
  to: number;
}

const LINE_RANGE = /^(.+):(\d+)-(\d+)$/;

/** The pieces an entry names, or why it names none. */
function resolveEntry(entry: string, idx: HunkIndex): Piece[] | string {
  const whole = (hunk: DiffHunk): Piece => ({ hunk, from: 1, to: slots(hunk, idx) });
  const hunk = idx.byId.get(entry);
  if (hunk) return [whole(hunk)];
  const file = idx.byFile.get(entry.replace(/^\.\//, ""));
  if (file) return file.hunks.map(whole);

  const [, id, a, b] = entry.match(LINE_RANGE) ?? [];
  const parent = id === undefined ? undefined : idx.byId.get(id);
  if (!parent) return `unknown hunk or file "${entry}".`;
  const [from, to, count] = [Number(a), Number(b), idx.lineCount.get(parent.id)!];
  if (count === 0) return `"${entry}": ${parent.id} has no text lines to split.`;
  if (from < 1 || to > count || from > to) return `"${entry}" is not a valid range of ${parent.id} (lines 1-${count}).`;
  return [{ hunk: parent, from, to }];
}

function pieceHunk({ hunk, from, to }: Piece, idx: HunkIndex): DiffHunk {
  return from === 1 && to === slots(hunk, idx) ? hunk : sliceHunk(hunk, from, to);
}

/** Splits `items` (line 1 first) into runs of neighbours with the same key. */
function runs<T>(items: T[], key: (item: T) => string) {
  const out: { from: number; to: number; item: T }[] = [];
  items.forEach((item, i) => {
    const last = out.at(-1);
    if (last && key(last.item) === key(item)) last.to = i + 1;
    else out.push({ from: i + 1, to: i + 1, item });
  });
  return out;
}

export function parsePlan(text: string): Plan {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Plan is not valid JSON: ${(e as Error).message}`);
  }
  const p = raw as Plan;
  if (!p || !Array.isArray(p.chunks)) throw new Error('Plan needs a "chunks" array.');
  if (p.overview !== undefined && typeof p.overview !== "string")
    throw new Error('"overview" must be a markdown string.');
  p.chunks.forEach((c, i) => {
    if (!c || typeof c.title !== "string" || !c.title.trim()) throw new Error(`Chunk ${i + 1} needs a "title".`);
    if (!Array.isArray(c.hunks) || c.hunks.some((h) => typeof h !== "string"))
      throw new Error(`Chunk ${i + 1} ("${c.title}") needs a "hunks" array of strings.`);
    if (c.visual !== undefined && typeof c.visual !== "string")
      throw new Error(`Chunk ${i + 1} ("${c.title}"): "visual" must be a markdown string.`);
  });
  return p;
}

export function checkPlan(plan: Plan, files: DiffFile[]): string[] {
  const idx = indexHunks(files);
  const errors: string[] = [];
  const owners = new Map<string, Set<number>[]>();
  for (const h of idx.byId.values()) owners.set(h.id, Array.from({ length: slots(h, idx) }, () => new Set()));
  plan.chunks.forEach((c, i) => {
    if (c.hunks.length === 0) errors.push(`Chunk ${i + 1} ("${c.title}") is empty.`);
    for (const entry of c.hunks) {
      const pieces = resolveEntry(entry, idx);
      if (typeof pieces === "string") {
        errors.push(`Chunk ${i + 1} ("${c.title}"): ${pieces}`);
        continue;
      }
      for (const { hunk, from, to } of pieces) {
        for (let line = from; line <= to; line++) owners.get(hunk.id)![line - 1]!.add(i);
      }
    }
  });

  const missing: string[] = [];
  for (const [id, lines] of owners) {
    for (const { from, to, item } of runs(lines, (chunks) => [...chunks].sort().join())) {
      const whole = from === 1 && to === lines.length;
      const where = whole ? id : from === to ? `${id} line ${from}` : `${id} lines ${from}-${to}`;
      const titles = [...item].sort((a, b) => a - b).map((i) => `"${plan.chunks[i]!.title}"`);
      if (titles.length === 0 && whole) missing.push(id);
      else if (titles.length === 0) errors.push(`${where} not in any chunk.`);
      else if (titles.length === 2) errors.push(`${where} is in both ${titles[0]} and ${titles[1]}.`);
      else if (titles.length > 2) errors.push(`${where} is in ${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}.`);
    }
  }
  if (missing.length) errors.push(`Hunks not in any chunk: ${missing.join(", ")}`);
  return errors;
}

function sha(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

function rangesOf(hunks: DiffHunk[]): LineRanges {
  const r: LineRanges = { additions: [], deletions: [] };
  for (const h of hunks) {
    const lines = [...hunkLines(h)];
    const newNos = lines.map((l) => l.newNo).filter((n) => n !== null);
    const oldNos = lines.map((l) => l.oldNo).filter((n) => n !== null);
    if (newNos.length) r.additions.push([Math.min(...newNos), Math.max(...newNos)]);
    if (oldNos.length) r.deletions.push([Math.min(...oldNos), Math.max(...oldNos)]);
  }
  return r;
}

function viewFile(file: DiffFile, hunks: DiffHunk[]): Omit<ViewFile, "expandable"> {
  hunks = [...hunks].sort((a, b) => a.index - b.index || (a.lines?.[0] ?? 0) - (b.lines?.[0] ?? 0));
  const body = hunks.map((h) => h.text).filter(Boolean);
  let note: string | undefined;
  if (body.length === 0) {
    if (file.status === "binary") note = "Binary file changed.";
    else if (file.status === "renamed") note = `Renamed from ${file.oldPath}, no content change.`;
    else note = "Mode or metadata change only.";
  }
  return {
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    patch: body.length ? `${file.header}\n${body.join("\n")}\n` : "",
    hunkIds: hunks.map((h) => h.id),
    added: hunks.reduce((n, h) => n + h.added, 0),
    removed: hunks.reduce((n, h) => n + h.removed, 0),
    ranges: rangesOf(hunks),
    note,
  };
}

type ChunkContent = Omit<ViewChunk, "key" | "reviewed" | "changedSinceApproval">;

interface ChunkSource {
  title: string;
  description: string;
  visual: string;
  hunks: DiffHunk[];
  unplanned: boolean;
}

const UNPLANNED_DESCRIPTION =
  "These changes are not in the plan, most likely edits made after it. Ask the agent to run `stackdiff plan` again.";

export function buildChunks(plan: Plan | null, files: DiffFile[], review: ReviewState): ViewChunk[] {
  const idx = indexHunks(files);
  const sources = plan ? chunksFromPlanKeepingLeftovers(plan, idx) : oneChunkPerFile(files);
  const chunks = sources.map((source) => toChunkContent(source, idx));
  return withUniqueKeys(chunks).map((chunk) => {
    const approvedHash = review.reviewed[chunk.key];
    return {
      ...chunk,
      reviewed: approvedHash === chunk.hash,
      changedSinceApproval: approvedHash !== undefined && approvedHash !== chunk.hash,
    };
  });
}

function chunksFromPlanKeepingLeftovers(plan: Plan, idx: HunkIndex): ChunkSource[] {
  const placed = new Map<string, boolean[]>();
  for (const h of idx.byId.values()) placed.set(h.id, Array(slots(h, idx)).fill(false));
  const sources: ChunkSource[] = [];
  for (const chunk of plan.chunks) {
    const pieces = chunk.hunks.flatMap((entry) => {
      const resolved = resolveEntry(entry, idx);
      return typeof resolved === "string" ? [] : resolved;
    });
    const hunks = takeUnplaced(pieces, placed, idx);
    if (hunks.length === 0) continue;
    sources.push({
      title: chunk.title,
      description: chunk.description ?? "",
      visual: chunk.visual ?? "",
      hunks,
      unplanned: false,
    });
  }
  const everything = [...idx.byId.values()].map((hunk) => ({ hunk, from: 1, to: slots(hunk, idx) }));
  const leftovers = takeUnplaced(everything, placed, idx);
  if (leftovers.length) {
    sources.push({
      title: UNPLANNED_TITLE,
      description: UNPLANNED_DESCRIPTION,
      visual: "",
      hunks: leftovers,
      unplanned: true,
    });
  }
  return sources;
}

/** Marks the pieces' lines placed and returns the ones no earlier chunk took, joined into runs. */
function takeUnplaced(pieces: Piece[], placed: Map<string, boolean[]>, idx: HunkIndex): DiffHunk[] {
  const taken = new Map<DiffHunk, boolean[]>();
  for (const { hunk, from, to } of pieces) {
    const done = placed.get(hunk.id)!;
    const mine = taken.get(hunk) ?? Array(done.length).fill(false);
    taken.set(hunk, mine);
    for (let line = from; line <= to; line++) {
      if (done[line - 1]) continue;
      done[line - 1] = mine[line - 1] = true;
    }
  }
  return [...taken].flatMap(([hunk, mine]) =>
    runs(mine, String)
      .filter((run) => run.item)
      .map((run) => pieceHunk({ hunk, from: run.from, to: run.to }, idx)),
  );
}

function oneChunkPerFile(files: DiffFile[]): ChunkSource[] {
  return files.map((file) => ({ title: file.path, description: "", visual: "", hunks: file.hunks, unplanned: true }));
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((n, item) => n + of(item), 0);
}

function toChunkContent(source: ChunkSource, idx: HunkIndex): ChunkContent {
  const hunksByFileInPlanOrder = Map.groupBy(source.hunks, (hunk) => hunk.file);
  const files = [...hunksByFileInPlanOrder].map(([path, hunks]) => {
    const file = idx.byFile.get(path)!;
    const held = (h: DiffHunk) => (h.lines ? h.lines[1] - h.lines[0] + 1 : slots(h, idx));
    const holdsEveryChange = sum(hunks, held) === sum(file.hunks, held);
    const hasBothSides = file.status === "modified" || file.status === "renamed";
    return { ...viewFile(file, hunks), expandable: holdsEveryChange && hasBothSides && hunks.some((h) => h.text) };
  });
  return {
    title: source.title,
    description: source.description,
    visual: source.visual,
    unplanned: source.unplanned,
    files,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
    hash: sha(files.map((f) => f.path + "\0" + f.patch).join("\0")),
  };
}

function withUniqueKeys(chunks: ChunkContent[]): (ChunkContent & { key: string })[] {
  const timesSeen = new Map<string, number>();
  return chunks.map((chunk) => {
    const n = (timesSeen.get(chunk.title) ?? 0) + 1;
    timesSeen.set(chunk.title, n);
    return { ...chunk, key: n === 1 ? chunk.title : `${chunk.title} (${n})` };
  });
}

function inRanges(ranges: [number, number][], line: number) {
  return ranges.some(([a, b]) => line >= a && line <= b);
}

export function locateComments(comments: Comment[], chunks: ViewChunk[], deliveredIds = new Set<string>()): ViewComment[] {
  return comments.map((c) => {
    const chunk = chunks.find((ch) => ch.files.some((f) => f.path === c.file && inRanges(f.ranges[c.side], c.endLine)));
    const seen = c.messages.every((m) => m.author === "agent" || !m.sent || deliveredIds.has(m.id));
    return { ...c, chunkKey: chunk?.key ?? null, seen };
  });
}

export interface AnchorMove {
  id: string;
  startLine: number;
  endLine: number;
  codeChanged: boolean;
}

/** The lines the diff shows on one side of a file, in order, without their +/-/space prefix. */
function diffLines(file: DiffFile, side: Side) {
  const out: { no: number; text: string }[] = [];
  for (const h of file.hunks) {
    for (const l of hunkLines(h)) {
      const no = side === "additions" ? l.newNo : l.oldNo;
      if (no !== null) out.push({ no, text: l.line.slice(1) });
    }
  }
  return out;
}

/**
 * Keeps each thread on the code it was left on. When edits above shift that code, the thread moves with it.
 * When the code itself is gone, the thread stays at the nearest line still in the diff, marked `codeChanged`.
 * Returns only the threads that move or change mark.
 */
export function followCode(comments: Comment[], files: DiffFile[]): AnchorMove[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const moves: AnchorMove[] = [];
  for (const c of comments) {
    const file = byPath.get(c.file);
    const lines = file ? diffLines(file, c.side) : [];
    if (!c.snippet || lines.length === 0) continue;
    const at = whereCodeIs(c, lines);
    const same = at.startLine === c.startLine && at.endLine === c.endLine && at.codeChanged === !!c.codeChanged;
    if (!same) moves.push({ id: c.id, ...at });
  }
  return moves;
}

function whereCodeIs(c: Comment, lines: { no: number; text: string }[]): Omit<AnchorMove, "id"> {
  const want = c.snippet.split("\n").map((l) => l.slice(1));
  const here = lines.filter((l) => l.no >= c.startLine && l.no <= c.endLine).map((l) => l.text);
  if (here.join("\n") === want.join("\n")) return { startLine: c.startLine, endLine: c.endLine, codeChanged: false };

  const distance = (i: number) => Math.abs(lines[i]!.no - c.startLine);
  let best: number | null = null;
  for (let i = 0; i + want.length <= lines.length; i++) {
    const matches = want.every((text, k) => lines[i + k]!.text === text);
    if (matches && (best === null || distance(i) < distance(best))) best = i;
  }
  if (best !== null) {
    return { startLine: lines[best]!.no, endLine: lines[best + want.length - 1]!.no, codeChanged: false };
  }

  if (lines.some((l) => l.no === c.endLine)) return { startLine: c.startLine, endLine: c.endLine, codeChanged: true };
  const nearest = lines.reduce((a, b) => (Math.abs(b.no - c.endLine) < Math.abs(a.no - c.endLine) ? b : a));
  return { startLine: nearest.no, endLine: nearest.no, codeChanged: true };
}

export function applyMoves(comments: Comment[], moves: AnchorMove[]) {
  for (const { id, startLine, endLine, codeChanged } of moves) {
    const c = comments.find((t) => t.id === id);
    if (!c) continue;
    c.startLine = startLine;
    c.endLine = endLine;
    if (codeChanged) c.codeChanged = true;
    else delete c.codeChanged;
  }
}

export function snippetFor(files: DiffFile[], path: string, side: Side, from: number, to: number): string {
  const file = files.find((f) => f.path === path);
  if (!file) return "";
  const [start, end] = [Math.min(from, to), Math.max(from, to)];
  const out: string[] = [];
  for (const h of file.hunks) {
    for (const l of hunkLines(h)) {
      const no = side === "additions" ? l.newNo : l.oldNo;
      if (no !== null && no >= start && no <= end) out.push(l.line);
    }
  }
  return out.join("\n");
}
