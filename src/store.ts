import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { currentBranch, fileAtCommit, findRepo, git, parseDiff, rawDiff, resolveBase } from "./git";
import { applyMoves, buildChunks, followCode, locateComments, parsePlan } from "./plan";
import { blobName, type Snapshot, sinceFile, snapshotFile, snapshotFiles } from "./since";
import type {
  Comment,
  DiffFile,
  Message,
  Plan,
  Review,
  ReviewState,
  ReviewedBy,
  SinceFile,
  ViewChunk,
  ViewState,
} from "./types";

export interface Config {
  base?: string;
}

export interface ServerInfo {
  port: number;
  pid: number;
  root: string;
}

const LISTENING_FRESH_MS = 4000;
const IMAGE_TYPES = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
/** The name `stackdiff plan` gives a stored screenshot: its content hash and type. */
export const STORED_IMAGE = /^[0-9a-f]{40}\.(png|jpe?g|gif|webp)$/;

export class Store {
  readonly root: string;
  readonly dir: string;

  constructor(cwd: string) {
    const repo = findRepo(cwd);
    this.root = repo.root;
    this.dir = join(repo.gitDir, "stackdiff");
    mkdirSync(this.dir, { recursive: true });
  }

  path(name: string) {
    return join(this.dir, name);
  }

  readText(name: string): string | null {
    const p = this.path(name);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  }

  readJSON<T>(name: string, fallback: T): T {
    const text = this.readText(name);
    if (text === null) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }

  writeJSON(name: string, value: unknown) {
    const tmp = this.path(`${name}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
    renameSync(tmp, this.path(name));
  }

  config(): Config {
    return this.readJSON<Config>("config.json", {});
  }

  review(): ReviewState {
    const s = this.readJSON<ReviewState>("review.json", {
      comments: [],
      reviews: [],
      reviewed: {},
      nextComment: 1,
      chat: [],
      nextChat: 1,
    });
    s.chat ??= [];
    s.nextChat ??= Math.max(0, ...s.chat.map((m) => Number(m.id.split(".").pop()) || 0)) + 1;
    s.comments = (s.comments as LegacyComment[]).map(upgradeLegacyComment);
    s.reviews = s.reviews.map(upgradeLegacyReview);
    return s;
  }

  updateReview<T>(fn: (s: ReviewState) => T): T {
    const state = this.review();
    const out = fn(state);
    this.writeJSON("review.json", state);
    return out;
  }

  plan(): { plan: Plan | null; error: string | null } {
    const text = this.readText("plan.json");
    if (text === null) return { plan: null, error: null };
    try {
      return { plan: parsePlan(text), error: null };
    } catch (e) {
      return { plan: null, error: (e as Error).message };
    }
  }

  /** `stackdiff wait` calls this every second while it runs. */
  markListening() {
    this.writeJSON("listening.json", { at: Date.now() });
  }

  stopListening() {
    rmSync(this.path("listening.json"), { force: true });
  }

  agentListening(): boolean {
    const at = this.readJSON<{ at: number } | null>("listening.json", null)?.at ?? 0;
    return Date.now() - at < LISTENING_FRESH_MS;
  }

  server(): ServerInfo | null {
    return this.readJSON<ServerInfo | null>("server.json", null);
  }

  base() {
    return resolveBase(this.root, this.config().base);
  }

  async rawDiff(): Promise<string> {
    return rawDiff(this.root, (await this.base()).commit);
  }

  async files(): Promise<DiffFile[]> {
    return parseDiff(await this.rawDiff());
  }

  /** Both sides of a changed file in full, so the UI can show the unchanged lines around its hunks. */
  async contents(path: string): Promise<{ old: string | null; new: string | null }> {
    const file = (await this.files()).find((f) => f.path === path);
    if (!file) throw new Error(`"${path}" is not in the diff.`);
    const { commit } = await this.base();
    return {
      old: file.status === "added" ? null : await fileAtCommit(this.root, commit, file.oldPath ?? file.path),
      new: file.status === "deleted" ? null : readFileSync(join(this.root, file.path), "utf8"),
    };
  }

  /** Saves where threads moved, so the agent reads the same lines the UI shows. */
  reviewFollowingCode(files: DiffFile[]): ReviewState {
    const state = this.review();
    if (followCode(state.comments, files).length === 0) return state;
    return this.updateReview((s) => {
      applyMoves(s.comments, followCode(s.comments, files));
      return s;
    });
  }

  snapshots(): Record<string, Snapshot> {
    return this.readJSON<Record<string, Snapshot>>("reviewed.json", {});
  }

  /** Keeps a copy of the chunk's code as the user reviews it, so a later change can show only what moved. */
  saveSnapshot(chunk: ViewChunk, reason: ReviewedBy) {
    mkdirSync(this.path("snapshots"), { recursive: true });
    const files: Snapshot["files"] = {};
    for (const f of snapshotFiles(chunk)) {
      const content = f.status === "deleted" ? null : readFileSync(join(this.root, f.path), "utf8");
      const blob = content === null ? null : blobName(content);
      if (blob && !existsSync(this.path(`snapshots/${blob}`))) writeFileSync(this.path(`snapshots/${blob}`), content!);
      files[f.path] = snapshotFile(f, blob);
    }
    this.writeSnapshots({ ...this.snapshots(), [chunk.key]: { reason, hash: chunk.hash, files } });
  }

  /** Saves a copy of each chunk holding one of these threads, as the user sends them. */
  async snapshotChunksOf(threadIds: string[]) {
    const { chunks, comments } = await this.view();
    const keys = new Set(comments.filter((c) => threadIds.includes(c.id)).map((c) => c.chunkKey));
    for (const chunk of chunks) if (keys.has(chunk.key)) this.saveSnapshot(chunk, "commenting");
  }

  private writeSnapshots(all: Record<string, Snapshot>) {
    this.writeJSON("reviewed.json", all);
    const used = new Set(Object.values(all).flatMap((s) => Object.values(s.files).map((f) => f.blob)));
    const dir = this.path("snapshots");
    for (const name of existsSync(dir) ? readdirSync(dir) : []) if (!used.has(name)) rmSync(join(dir, name));
  }

  /** What is wrong with the plan's screenshot files, resolving relative paths from `cwd`. */
  checkScreenshots(plan: Plan, cwd: string): string[] {
    return plan.chunks.flatMap((c, i) =>
      (c.screenshots ?? []).flatMap(({ path }) => {
        const where = `Chunk ${i + 1} ("${c.title}"): screenshot "${path}"`;
        if (!IMAGE_TYPES.includes(extname(path).toLowerCase())) return [`${where} is not a ${IMAGE_TYPES.join(", ")} file.`];
        if (!statSync(resolve(cwd, path), { throwIfNoEntry: false })?.isFile()) return [`${where} not found.`];
        return [];
      }),
    );
  }

  /**
   * Copies the plan's screenshots into `images/`, named by content, and points the plan at the copies,
   * so the agent's files can go. Deletes copies no chunk uses any more.
   */
  storeScreenshots(plan: Plan, cwd: string) {
    mkdirSync(this.path("images"), { recursive: true });
    for (const shot of plan.chunks.flatMap((c) => c.screenshots ?? [])) {
      const from = resolve(cwd, shot.path);
      const name = blobName(readFileSync(from)) + extname(from).toLowerCase();
      if (!existsSync(this.path(`images/${name}`))) copyFileSync(from, this.path(`images/${name}`));
      shot.path = name;
    }
    const used = new Set(plan.chunks.flatMap((c) => (c.screenshots ?? []).map((s) => s.path)));
    for (const name of readdirSync(this.path("images"))) if (!used.has(name)) rmSync(this.path(`images/${name}`));
  }

  /** Per file, the chunk against the code as last reviewed. */
  async sinceReview(chunk: ViewChunk, snapshot: Snapshot): Promise<Record<string, SinceFile>> {
    const entries = snapshotFiles(chunk).map(async (file): Promise<[string, SinceFile]> => {
      const then = snapshot.files[file.path];
      if (!then) return [file.path, { patch: file.patch, expandable: false, joined: true }];
      const before = then.blob ? this.path(`snapshots/${then.blob}`) : "/dev/null";
      const after = file.status === "deleted" ? "/dev/null" : join(this.root, file.path);
      const res = await git(this.root, ["diff", "--no-index", "--no-color", "--no-ext-diff", "-U3", "--", before, after]);
      return [file.path, sinceFile(file, then, res.stdout)];
    });
    return Object.fromEntries(await Promise.all(entries));
  }

  /** Both sides of a file as the chunk was last reviewed and as it is now, so the UI can expand around its hunks. */
  sinceContents(chunkKey: string, path: string): { old: string | null; new: string | null } {
    const blob = this.snapshots()[chunkKey]?.files[path]?.blob;
    if (blob === undefined) throw new Error(`No reviewed copy of "${path}" in "${chunkKey}".`);
    const current = join(this.root, path);
    return {
      old: blob === null ? null : readFileSync(this.path(`snapshots/${blob}`), "utf8"),
      new: existsSync(current) ? readFileSync(current, "utf8") : null,
    };
  }

  async view(): Promise<ViewState> {
    const base = await this.base();
    const files = parseDiff(await rawDiff(this.root, base.commit));
    const review = this.reviewFollowingCode(files);
    const { plan, error } = this.plan();
    const snapshots = this.snapshots();
    const delivered = deliveredMessageIds(review);
    const chunks = await Promise.all(
      buildChunks(plan, files, review).map(async (c) => {
        const then = snapshots[c.key];
        const changed = then && (then.hash ? then.hash !== c.hash : c.changedSinceApproval);
        return changed ? { ...c, sinceReview: { by: then.reason ?? "approving", files: await this.sinceReview(c, then) } } : c;
      }),
    );
    return {
      root: this.root,
      branch: await currentBranch(this.root),
      base: base.label,
      title: plan?.title ?? "",
      summary: plan?.summary ?? "",
      overview: plan?.overview ?? "",
      hasPlan: plan !== null,
      planError: error,
      chunks,
      comments: locateComments(review.comments, chunks, delivered),
      chat: review.chat.map((m) => ({ ...m, seen: m.author === "agent" || delivered.has(m.id) })),
      waitingReviews: review.reviews.filter((r) => !r.delivered && r.verdict !== "question" && r.verdict !== "chat").length,
      agentListening: this.agentListening(),
    };
  }
}

function deliveredMessageIds(state: ReviewState) {
  return new Set(state.reviews.filter((r) => r.delivered).flatMap((r) => r.messageIds));
}

type LegacyComment = Omit<Comment, "kind" | "status" | "messages"> & {
  kind?: Comment["kind"];
  status: string;
  messages?: Message[];
  body?: string;
  reply?: string;
  sentAt?: string;
  resolvedAt?: string;
};

function upgradeLegacyComment(c: LegacyComment): Comment {
  const isAlreadyAThread = Array.isArray(c.messages);
  if (isAlreadyAThread) return { ...c, kind: c.kind ?? "change" } as Comment;
  const { body, reply, sentAt: _sentAt, resolvedAt: _resolvedAt, messages: _messages, ...rest } = c;
  const messages: Message[] = [
    { id: `${c.id}.1`, author: "user", body: body ?? "", at: c.createdAt, sent: c.status !== "draft" },
  ];
  if (reply) messages.push({ id: `${c.id}.2`, author: "agent", body: reply, at: c.createdAt, sent: true });
  return { ...rest, kind: "change", status: c.status === "resolved" ? "resolved" : "open", messages };
}

function upgradeLegacyReview(r: Review & { commentIds?: string[] }): Review {
  return { ...r, threadIds: r.threadIds ?? r.commentIds ?? [], messageIds: r.messageIds ?? [] };
}
