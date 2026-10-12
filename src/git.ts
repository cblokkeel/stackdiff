import { spawnSync } from "node:child_process";
import type { DiffFile, DiffHunk, FileStatus } from "./types";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function git(cwd: string, args: string[]): Promise<GitResult> {
  const proc = Bun.spawn(["git", "-c", "core.quotepath=false", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function gitOk(cwd: string, args: string[]): Promise<string> {
  const res = await git(cwd, args);
  if (res.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim()}`);
  return res.stdout;
}

export interface RepoInfo {
  root: string;
  gitDir: string;
}

export function findRepo(cwd: string): RepoInfo {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel", "--absolute-git-dir"], { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error("Not inside a git repository.");
  const [root, gitDir] = res.stdout.trim().split("\n");
  return { root: root!, gitDir: gitDir! };
}

export async function currentBranch(root: string): Promise<string> {
  const res = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return res.code === 0 ? res.stdout.trim() : "(no commits)";
}

const BASE_CANDIDATES = ["main", "master", "origin/main", "origin/master"];

export async function resolveBase(root: string, base?: string): Promise<{ commit: string; label: string }> {
  if ((await git(root, ["rev-parse", "--verify", "-q", "HEAD"])).code !== 0) {
    return { commit: EMPTY_TREE, label: "(empty)" };
  }
  const candidates = base ? [base] : BASE_CANDIDATES;
  for (const ref of candidates) {
    if ((await git(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])).code !== 0) continue;
    const mb = await git(root, ["merge-base", "HEAD", ref]);
    if (mb.code === 0) return { commit: mb.stdout.trim(), label: ref };
  }
  if (base) throw new Error(`Base "${base}" not found.`);
  return { commit: "HEAD", label: "HEAD" };
}

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--find-renames", "--src-prefix=a/", "--dst-prefix=b/", "-U3"];

const MAX_PARALLEL_GIT = 16;
const GIT_DIFF_FOUND_DIFFERENCES = 1;

export async function rawDiff(root: string, baseCommit: string): Promise<string> {
  const trackedDiff = await gitOk(root, ["diff", ...DIFF_FLAGS, baseCommit]);
  const untrackedDiffs = await diffUntrackedFiles(root);
  return [trackedDiff, ...untrackedDiffs].filter(Boolean).map(endWithNewline).join("");
}

export async function fileAtCommit(root: string, commit: string, path: string): Promise<string> {
  return gitOk(root, ["show", `${commit}:${path}`]);
}

async function diffUntrackedFiles(root: string): Promise<string[]> {
  const listing = await gitOk(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const files = listing.split("\0").filter(Boolean);
  const diffs: string[] = [];
  for (const batch of inBatches(files, MAX_PARALLEL_GIT)) {
    const results = await Promise.all(
      batch.map((file) => git(root, ["diff", "--no-index", ...DIFF_FLAGS, "--", "/dev/null", file])),
    );
    for (const result of results) if (result.code <= GIT_DIFF_FOUND_DIFFERENCES) diffs.push(result.stdout);
  }
  return diffs;
}

function inBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function endWithNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const DIFF_GIT_LINE_PATHS = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/;

export function parseDiff(text: string): DiffFile[] {
  return text
    .split(/^(?=diff --git )/m)
    .filter((section) => section.startsWith("diff --git "))
    .map(parseFileSection);
}

function parseFileSection(section: string): DiffFile {
  const lines = section.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const firstHunkLine = lines.findIndex((line) => HUNK_HEADER.test(line));
  const headerLines = firstHunkLine === -1 ? lines : lines.slice(0, firstHunkLine);
  const hunkLines = firstHunkLine === -1 ? [] : lines.slice(firstHunkLine);

  const { path, oldPath, status } = parseFileHeader(headerLines);
  const hunks = parseHunks(path, hunkLines);
  return {
    path,
    oldPath: status === "renamed" ? oldPath : null,
    status,
    header: headerLines.join("\n"),
    hunks: hunks.length ? hunks : [hunkForChangeWithoutText(path)],
  };
}

function parseFileHeader(headerLines: string[]) {
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let renamedFrom: string | null = null;
  let renamedTo: string | null = null;
  let isNew = false;
  let isDeleted = false;
  let isBinary = false;

  for (const line of headerLines) {
    if (line.startsWith("--- ")) oldPath = pathFromHeader(line.slice(4));
    else if (line.startsWith("+++ ")) newPath = pathFromHeader(line.slice(4));
    else if (line.startsWith("rename from ")) renamedFrom = unquote(line.slice(12));
    else if (line.startsWith("rename to ")) renamedTo = unquote(line.slice(10));
    else if (line.startsWith("new file mode")) isNew = true;
    else if (line.startsWith("deleted file mode")) isDeleted = true;
    else if (line.startsWith("Binary files ")) isBinary = true;
  }

  const hasNoContentLines = !oldPath && !newPath;
  if (hasNoContentLines) {
    const [, fromPath, toPath] = headerLines[0]!.match(DIFF_GIT_LINE_PATHS) ?? [];
    oldPath = isNew ? null : (fromPath ?? null);
    newPath = isDeleted ? null : (toPath ?? null);
  }
  oldPath = renamedFrom ?? oldPath;
  newPath = renamedTo ?? newPath;

  let status: FileStatus = "modified";
  if (isBinary) status = "binary";
  else if (isNew || oldPath === null) status = "added";
  else if (isDeleted || newPath === null) status = "deleted";
  else if (renamedFrom && renamedFrom !== renamedTo) status = "renamed";

  return { path: newPath ?? oldPath ?? "(unknown)", oldPath, status };
}

function parseHunks(path: string, lines: string[]): DiffHunk[] {
  const hunkTexts: string[][] = [];
  for (const line of lines) {
    if (HUNK_HEADER.test(line)) hunkTexts.push([line]);
    else hunkTexts.at(-1)?.push(line);
  }
  return hunkTexts.map((hunkText, i) => {
    const [, oldStart, newStart] = hunkText[0]!.match(HUNK_HEADER)!;
    const body = hunkText.slice(1);
    return {
      id: `${path}#${i + 1}`,
      file: path,
      index: i + 1,
      header: hunkText[0]!,
      text: hunkText.join("\n"),
      added: body.filter((line) => line.startsWith("+")).length,
      removed: body.filter((line) => line.startsWith("-")).length,
      oldStart: Number(oldStart),
      newStart: Number(newStart),
    };
  });
}

function hunkForChangeWithoutText(path: string): DiffHunk {
  return {
    id: `${path}#1`,
    file: path,
    index: 1,
    header: "",
    text: "",
    added: 0,
    removed: 0,
    oldStart: 0,
    newStart: 0,
  };
}

function unquote(path: string): string {
  const isQuoted = path.startsWith('"') && path.endsWith('"');
  return isQuoted ? path.slice(1, -1).replace(/\\(.)/g, "$1") : path;
}

function pathFromHeader(raw: string): string | null {
  const path = unquote(raw.trim());
  return path === "/dev/null" ? null : path.replace(/^[ab]\//, "");
}

const NO_NEWLINE_MARKER = "\\";

export function* hunkLines(hunk: DiffHunk) {
  if (!hunk.text) return;
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  for (const line of hunk.text.split("\n").slice(1)) {
    const kind = line[0];
    if (kind === NO_NEWLINE_MARKER) continue;
    if (kind === "+") yield { kind, line, oldNo: null, newNo: newNo++ };
    else if (kind === "-") yield { kind, line, oldNo: oldNo++, newNo: null };
    else yield { kind: " ", line, oldNo: oldNo++, newNo: newNo++ };
  }
}

/**
 * Body lines `from`..`to` (1-based, inclusive, "\ No newline" markers not
 * counted) of a hunk, as a hunk of their own with real line numbers.
 */
export function sliceHunk(hunk: DiffHunk, from: number, to: number): DiffHunk {
  const lines = [...hunkLines(hunk)];
  const before = lines.slice(0, from - 1);
  const kept = lines.slice(from - 1, to);
  const old = sliceSide(lines, before, kept, "oldNo", hunk.oldStart);
  const neu = sliceSide(lines, before, kept, "newNo", hunk.newStart);
  const header = `@@ -${old.start},${old.count} +${neu.start},${neu.count} @@`;

  let lineNo = 0;
  const body = hunk.text
    .split("\n")
    .slice(1)
    .filter((line) => {
      if (line[0] !== NO_NEWLINE_MARKER) lineNo++;
      return lineNo >= from && lineNo <= to;
    });
  return {
    ...hunk,
    id: `${hunk.id}:${from}-${to}`,
    header,
    text: [header, ...body].join("\n"),
    added: kept.filter((l) => l.kind === "+").length,
    removed: kept.filter((l) => l.kind === "-").length,
    oldStart: old.start,
    newStart: neu.start,
    lines: [from, to],
  };
}

type NumberedLine = ReturnType<typeof hunkLines> extends Generator<infer L> ? L : never;

// A side with no lines names the line before the gap ("-5,0" inserts after old line 5).
function sliceSide(
  all: NumberedLine[],
  before: NumberedLine[],
  kept: NumberedLine[],
  side: "oldNo" | "newNo",
  headerStart: number,
) {
  const onSide = (l: NumberedLine) => l[side] !== null;
  const firstLine = all.some(onSide) ? headerStart : headerStart + 1;
  const next = firstLine + before.filter(onSide).length;
  const count = kept.filter(onSide).length;
  return { start: count ? next : next - 1, count };
}
