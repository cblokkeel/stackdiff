import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, openSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store";

const PACKAGE_DIR = join(import.meta.dir, "..");
const CLI = join(import.meta.dir, "cli.ts");
export const WEB_DIR = join(PACKAGE_DIR, "dist", "web");
const START_ATTEMPTS = 50;
const START_POLL_MS = 150;
const PORT_RANGE_START = 4300;
const PORT_RANGE_SIZE = 600;
const HEALTH_TIMEOUT_MS = 800;
const STOP_ATTEMPTS = 20;
const STOP_POLL_MS = 100;

export interface RunningServer {
  url: string;
  pid: number;
  stamp: string;
}

export function codeVersionStamp(): string {
  const files = readdirSync(import.meta.dir).map((f) => join(import.meta.dir, f));
  files.push(join(WEB_DIR, "index.html"));
  const latest = Math.max(...files.map((f) => statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? 0));
  return String(Math.round(latest));
}

export function stablePortForRepo(root: string): number {
  const hash = createHash("sha1").update(root).digest();
  return PORT_RANGE_START + (hash.readUInt16BE(0) % PORT_RANGE_SIZE);
}

export async function findServer(store: Store): Promise<RunningServer | null> {
  const info = store.server();
  if (!info) return null;
  const url = `http://127.0.0.1:${info.port}`;
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const health = (await res.json()) as { root: string; pid: number; stamp: string };
    return health.root === store.root ? { url, pid: health.pid, stamp: health.stamp } : null;
  } catch {
    return null;
  }
}

export async function ensureServer(store: Store, { openBrowser = false } = {}): Promise<string> {
  buildUiIfMissing();
  const running = await findServer(store);
  if (running?.stamp === codeVersionStamp()) return running.url;

  const outdatedServer = running;
  const portToKeep = outdatedServer ? store.server()?.port : undefined;
  if (outdatedServer) await stopServer(store);

  spawnServer(store, portToKeep);
  for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
    await Bun.sleep(START_POLL_MS);
    const started = await findServer(store);
    if (started) {
      const browserTabAlreadyOpen = outdatedServer !== null;
      if (openBrowser && !browserTabAlreadyOpen) openInBrowser(started.url);
      return started.url;
    }
  }
  throw new Error(`Server did not start. See ${store.path("server.log")}`);
}

export async function stopServer(store: Store): Promise<boolean> {
  const running = await findServer(store);
  if (!running) return false;
  process.kill(running.pid, "SIGTERM");
  for (let attempt = 0; attempt < STOP_ATTEMPTS && (await findServer(store)); attempt++) await Bun.sleep(STOP_POLL_MS);
  return true;
}

export function spawnServer(store: Store, port?: number) {
  const log = openSync(store.path("server.log"), "a");
  const args = [CLI, "serve", ...(port ? ["--port", String(port)] : [])];
  spawn(process.execPath, args, { cwd: store.root, detached: true, stdio: ["ignore", log, log] }).unref();
}

function buildUiIfMissing() {
  if (existsSync(join(WEB_DIR, "index.html"))) return;
  console.error("Building the web UI (first run only)...");
  const res = spawnSync(process.execPath, ["x", "vite", "build"], {
    cwd: PACKAGE_DIR,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (res.status !== 0) throw new Error(`Web UI build failed. Run \`bun run build\` in ${PACKAGE_DIR}`);
}

function openInBrowser(url: string) {
  const command = { darwin: "open", win32: "start" }[process.platform as string] ?? "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}
