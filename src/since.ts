import { createHash } from "node:crypto";
import { hunkLines, parseDiff } from "./git";
import type { DiffHunk, ReviewedBy, SinceFile, ViewChunk, ViewFile } from "./types";

/** A file as the user last reviewed it, kept so a later change can be shown against it. */
export interface SnapshotFile {
  /** The new side's content, by hash in `snapshots/`. Null when the file was deleted. */
  blob: string | null;
  /** New-side line ranges the chunk held in this file. */
  ranges?: [number, number][];
}

/** A chunk as the user last reviewed it: when they approved it or sent comments on it. */
export interface Snapshot {
  reason: ReviewedBy;
  /** The chunk's hash then. Copies saved before it was kept have none. */
  hash?: string;
  files: Record<string, SnapshotFile>;
}

export function blobName(content: string | Uint8Array): string {
  return createHash("sha1").update(content).digest("hex");
}

export function snapshotFiles(chunk: ViewChunk) {
  return chunk.files.filter((f) => f.patch && f.status !== "binary");
}

export function snapshotFile(file: ViewFile, blob: string | null): SnapshotFile {
  return { blob, ranges: file.ranges.additions };
}

const inRanges = (ranges: [number, number][], line: number | null) =>
  line !== null && ranges.some(([a, b]) => line >= a && line <= b);

/** The hunk changes a line the chunk held then (`before`) or holds now (`after`). */
function touchesChunk(hunk: DiffHunk, before: [number, number][], after: [number, number][]) {
  return [...hunkLines(hunk)].some(
    (l) => (l.kind === "-" && inRanges(before, l.oldNo)) || (l.kind === "+" && inRanges(after, l.newNo)),
  );
}

/**
 * The reviewed copy of `file` against the file now, from `git diff --no-index` output, holding only
 * the hunks inside this chunk.
 */
export function sinceFile(file: ViewFile, then: SnapshotFile, rawDiff: string): SinceFile {
  const firstHunk = rawDiff.search(/^@@ /m);
  if (firstHunk === -1) return { patch: "", expandable: false, joined: false };
  const existsNow = file.status !== "deleted";
  const header = [
    `diff --git a/${file.path} b/${file.path}`,
    `--- ${then.blob ? `a/${file.path}` : "/dev/null"}`,
    `+++ ${existsNow ? `b/${file.path}` : "/dev/null"}`,
  ].join("\n");
  const all = parseDiff(`${header}\n${rawDiff.slice(firstHunk)}`)[0]!.hunks;
  // Copies saved before ranges were kept hold none: count every removed line as the chunk's.
  const before = then.ranges ?? [[1, Number.MAX_SAFE_INTEGER]];
  const hunks = all.filter((h) => touchesChunk(h, before, file.ranges.additions));
  return {
    patch: hunks.length ? `${header}\n${hunks.map((h) => h.text).join("\n")}\n` : "",
    // Other chunks' changes left out between the hunks would make "N unmodified lines" lie.
    expandable: hunks.length === all.length && then.blob !== null && existsNow,
    joined: false,
  };
}
