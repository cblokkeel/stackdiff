import { createHash } from "node:crypto";
import { rmSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { codeVersionStamp, spawnServer, WEB_DIR } from "./daemon";
import { snippetFor } from "./plan";
import * as review from "./review";
import type { Store } from "./store";
import type { ChatCode, CommentKind, CommentStatus, Side, Verdict } from "./types";

type Params = Record<string, string>;
type Handler = (req: Request, params: Params) => Response | Promise<Response>;
type Route = [method: string, pattern: string, handler: Handler];

const VERSION_CACHE_MS = 1000;
const CODE_CHECK_MS = 2000;

const now = () => new Date().toISOString();
const json = (data: unknown, status = 200) => Response.json(data, { status });
const error = (message: string, status: number) => json({ error: message }, status);

export function startServer(store: Store, port: number) {
  const stamp = codeVersionStamp();
  const version = versionOfEverythingShown(store);

  const routes: Route[] = [
    ["GET", "/api/health", () => json({ root: store.root, pid: process.pid, stamp })],

    ["GET", "/api/state", async () => json(await store.view())],

    ["GET", "/api/version", async () => json({ version: await version() })],

    [
      "GET",
      "/api/contents",
      async (req) => {
        const params = new URL(req.url).searchParams;
        const [path, since] = [params.get("path") ?? "", params.get("since")];
        return json(since === null ? await store.contents(path) : store.sinceContents(since, path));
      },
    ],

    [
      "POST",
      "/api/comments",
      async (req) => {
        const b = (await req.json()) as {
          file: string;
          side: Side;
          startLine: number;
          endLine: number;
          chunkTitle: string;
          body: string;
          kind?: CommentKind;
        };
        const snippet = snippetFor(await store.files(), b.file, b.side, b.startLine, b.endLine);
        const anchor = { ...b, snippet };
        const thread = store.updateReview((s) => review.addThread(s, anchor, b.body, now(), b.kind));
        if (thread.kind === "question") await store.snapshotChunksOf([thread.id]);
        return json(thread);
      },
    ],

    [
      "PATCH",
      "/api/comments/:id",
      async (req, { id }) => {
        const { status } = (await req.json()) as { status: CommentStatus };
        store.updateReview((s) => review.setStatus(review.findThread(s.comments, id!), status));
        return json({ ok: true });
      },
    ],

    [
      "DELETE",
      "/api/comments/:id",
      (_req, { id }) => {
        store.updateReview((s) => review.deleteThread(s.comments, id!));
        return json({ ok: true });
      },
    ],

    [
      "POST",
      "/api/comments/:id/messages",
      async (req, { id }) => {
        const { body } = (await req.json()) as { body: string };
        const { message, kind } = store.updateReview((s) => {
          const thread = review.findThread(s.comments, id!);
          return { message: review.addReply(s, thread, body, now()), kind: thread.kind };
        });
        if (kind === "question") await store.snapshotChunksOf([id!]);
        return json(message);
      },
    ],

    [
      "PATCH",
      "/api/comments/:id/messages/:messageId",
      async (req, { id, messageId }) => {
        const { body } = (await req.json()) as { body: string };
        store.updateReview((s) => review.editMessage(review.findThread(s.comments, id!), messageId!, body));
        return json({ ok: true });
      },
    ],

    [
      "DELETE",
      "/api/comments/:id/messages/:messageId",
      (_req, { id, messageId }) => {
        store.updateReview((s) => review.deleteMessage(s.comments, id!, messageId!));
        return json({ ok: true });
      },
    ],

    [
      "POST",
      "/api/chat",
      async (req) => {
        const b = (await req.json()) as { body: string; chunkTitle?: string; code?: Omit<ChatCode, "snippet"> };
        const code = b.code && {
          ...b.code,
          snippet: snippetFor(await store.files(), b.code.file, b.code.side, b.code.startLine, b.code.endLine),
        };
        return json(store.updateReview((s) => review.addChatMessage(s, b.body, now(), b.chunkTitle, code)));
      },
    ],

    [
      "DELETE",
      "/api/chat/:id",
      (_req, { id }) => {
        store.updateReview((s) => review.cancelChatMessage(s, id!));
        return json({ ok: true });
      },
    ],

    [
      "POST",
      "/api/review",
      async (req) => {
        const { verdict, body, chunkKey, threadIds: only } = (await req.json()) as {
          verdict: Verdict;
          body?: string;
          chunkKey?: string;
          threadIds?: string[];
        };
        const threadIds = chunkKey
          ? (await store.view()).comments.filter((c) => c.chunkKey === chunkKey).map((c) => c.id)
          : only;
        const sent = store.updateReview((s) => review.submitReview(s, verdict, body ?? "", now(), threadIds));
        await store.snapshotChunksOf(sent.threadIds);
        return json(sent);
      },
    ],

    [
      "POST",
      "/api/reviewed",
      async (req) => {
        const { key, hash, reviewed } = (await req.json()) as { key: string; hash: string; reviewed: boolean };
        const approvedAsShown = reviewed && (await store.view()).chunks.find((c) => c.key === key && c.hash === hash);
        if (approvedAsShown) store.saveSnapshot(approvedAsShown, "approving");
        store.updateReview((s) => review.setReviewed(s, key, hash, reviewed));
        return json({ ok: true });
      },
    ],
  ];

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (!pathname.startsWith("/api/")) return serveUiFileOrIndex(pathname);
      try {
        for (const [method, pattern, handler] of routes) {
          const params = req.method === method ? matchPath(pattern, pathname) : null;
          if (params) return await handler(req, params);
        }
        return error("Not found.", 404);
      } catch (e) {
        return error((e as Error).message, e instanceof review.ReviewError ? 400 : 500);
      }
    },
  });

  store.writeJSON("server.json", { port: server.port, pid: process.pid, root: store.root });
  const shutDown = () => {
    if (store.server()?.pid === process.pid) rmSync(store.path("server.json"), { force: true });
    process.exit(0);
  };
  process.on("SIGINT", shutDown);
  process.on("SIGTERM", shutDown);
  restartWhenCodeChanges(store, server, stamp);
  return server;
}

/**
 * The UI loads from disk on every refresh, so a server older than the code would hand new pages old data.
 * A server the CLI started in the background swaps itself for a fresh one on the same port instead.
 */
function restartWhenCodeChanges(store: Store, server: Bun.Server<undefined>, stamp: string) {
  const startedByHand = process.stdout.isTTY;
  if (startedByHand) return;
  setInterval(() => {
    if (codeVersionStamp() === stamp) return;
    server.stop(true);
    spawnServer(store, server.port);
    process.exit(0);
  }, CODE_CHECK_MS);
}

function matchPath(pattern: string, path: string): Params | null {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return null;
  const params: Params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i]!.startsWith(":")) params[want[i]!.slice(1)] = decodeURIComponent(got[i]!);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

function serveUiFileOrIndex(pathname: string): Response {
  const rel = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const file = join(WEB_DIR, rel);
  const isFile = file.startsWith(WEB_DIR) && statSync(file, { throwIfNoEntry: false })?.isFile();
  return new Response(Bun.file(isFile ? file : join(WEB_DIR, "index.html")));
}

function versionOfEverythingShown(store: Store) {
  let cached = { at: 0, value: Promise.resolve("") };
  const compute = async () => {
    const hash = createHash("sha1");
    hash.update(await store.rawDiff());
    hash.update(store.readText("plan.json") ?? "");
    hash.update(store.readText("review.json") ?? "");
    hash.update(String(store.agentListening()));
    return hash.digest("hex");
  };
  return () => {
    if (Date.now() - cached.at > VERSION_CACHE_MS) cached = { at: Date.now(), value: compute() };
    return cached.value;
  };
}
