#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ensureServer, findServer, stablePortForRepo, stopServer } from "./daemon";
import { formatHunkLines, formatHunks, formatReviews, formatStatus } from "./format";
import { resolveBase } from "./git";
import { checkPlan, parsePlan } from "./plan";
import * as review from "./review";
import { startServer } from "./server";
import { installSkill } from "./skill";
import { Store } from "./store";
import type { DiffFile, DiffHunk } from "./types";

const HELP = `stackdiff: review large agent changes as a local stack of small chunks

Usage:
  stackdiff open [--base <ref>] [--no-browser]   Start the UI for this repo and print its URL
  stackdiff hunks [--json]                       List changed hunks and their ids
  stackdiff hunks <id...>                        Print hunks with numbered lines, for path#n:a-b entries
  stackdiff plan <file|-> [--overview <file>]    Check and save the chunk plan, with an optional markdown overview
  stackdiff wait [--timeout <secs>]              Wait for the user's review and print it
  stackdiff reply <id...> -m <message>           Answer a comment thread, keep it open
  stackdiff resolve <id...> [-m <message>]       Close a comment thread, with an optional last message
  stackdiff chat -m <message>                    Answer the user in the chat panel
  stackdiff status                               Show URL, plan and comment counts
  stackdiff stop                                 Stop the server
  stackdiff install-skill                        Link the stackdiff skill into ~/.claude and ~/.agents
`;

const WAIT_SECS_UNDER_HARNESS_COMMAND_TIMEOUT = 9 * 60;
const SERVER_CHECK_EVERY_SECS = 5;
const ANY_FREE_PORT = 0;

const OPTIONS = {
  base: { type: "string" },
  "no-browser": { type: "boolean" },
  json: { type: "boolean" },
  timeout: { type: "string" },
  message: { type: "string", short: "m" },
  port: { type: "string" },
  overview: { type: "string" },
} as const;

type Args = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
type Command = (store: Store, args: Args) => Promise<void>;

const commands: Record<string, Command> = {
  async open(store, { values }) {
    if (values.base) await saveBaseBranch(store, values.base);
    console.log(await ensureServer(store, { openBrowser: !values["no-browser"] }));
    if (!store.plan().plan) {
      console.log("No plan yet: the UI shows one chunk per file. Ask the agent to write one.");
    }
  },

  async hunks(store, { values, positionals: ids }) {
    const files = await store.files();
    if (ids.length) return console.log(ids.map((id) => formatHunkLines(findHunk(files, id))).join("\n\n"));
    if (values.json) return console.log(JSON.stringify(files, null, 2));
    const { label } = await store.base();
    console.log(files.length ? formatHunks(files, label) : `No changes against ${label}.`);
  },

  async plan(store, { positionals: [source], values }) {
    if (!source) throw new Error("Usage: stackdiff plan <file|-> [--overview <file>]");
    const plan = parsePlan(source === "-" ? await Bun.stdin.text() : readFileSync(source, "utf8"));
    if (values.overview) plan.overview = readFileSync(values.overview, "utf8");
    const files = await store.files();
    const errors = checkPlan(plan, files);
    if (errors.length) throw new Error(`Plan not saved:\n- ${errors.join("\n- ")}`);

    store.writeJSON("plan.json", plan);
    const hunkCount = files.reduce((n, f) => n + f.hunks.length, 0);
    const withOverview = plan.overview?.trim() ? ", with an overview" : "";
    console.log(`Plan saved: ${plan.chunks.length} chunks covering ${hunkCount} hunks${withOverview}.`);
    const server = await findServer(store);
    console.log(server ? `UI: ${server.url}` : "Run `stackdiff open` to start the UI.");
  },

  async wait(store, { values }) {
    const secs = values.timeout ? Number(values.timeout) : WAIT_SECS_UNDER_HARNESS_COMMAND_TIMEOUT;
    const deadline = Date.now() + secs * 1000;
    const url = await ensureServer(store, { openBrowser: !values["no-browser"] });
    console.error(`Waiting for review at ${url}`);

    try {
      for (let second = 1; Date.now() < deadline; second++) {
        store.markListening();
        const reviews = takeUndeliveredReviews(store);
        if (reviews.length) {
          const state = store.reviewFollowingCode(await store.files());
          return console.log(formatReviews(reviews, state.comments, state.chat));
        }
        if (second % SERVER_CHECK_EVERY_SECS === 0) await restartServerIfDown(store);
        await Bun.sleep(1000);
      }
    } finally {
      store.stopListening();
    }
    const waited = secs >= 60 ? `${Math.round(secs / 60)} min` : `${secs}s`;
    console.log(`No review yet (waited ${waited}). Run \`stackdiff wait\` again.`);
  },

  async reply(store, { positionals: ids, values }) {
    if (!ids.length || !values.message) throw new Error('Usage: stackdiff reply <id...> -m "message"');
    answerThreads(store, ids, values.message, { resolve: false });
    console.log(`Replied to ${ids.join(", ")}`);
  },

  async resolve(store, { positionals: ids, values }) {
    if (!ids.length) throw new Error('Usage: stackdiff resolve <id...> [-m "message"]');
    answerThreads(store, ids, values.message, { resolve: true });
    console.log(`Resolved ${ids.join(", ")}`);
  },

  async chat(store, { values }) {
    if (!values.message) throw new Error('Usage: stackdiff chat -m "message"');
    store.updateReview((s) => review.addAgentChatMessage(s, values.message!, new Date().toISOString()));
    console.log("Sent to the chat.");
  },

  async status(store) {
    const server = await findServer(store);
    console.log(formatStatus(await store.view(), server?.url ?? null));
  },

  async stop(store) {
    console.log((await stopServer(store)) ? "Stopped." : "Not running.");
  },

  async serve(store, { values }) {
    try {
      startServer(store, values.port ? Number(values.port) : stablePortForRepo(store.root));
    } catch {
      startServer(store, ANY_FREE_PORT);
    }
  },
};

function findHunk(files: DiffFile[], id: string): DiffHunk {
  const hunk = files.flatMap((f) => f.hunks).find((h) => h.id === id);
  if (!hunk) throw new Error(`Unknown hunk "${id}". Run \`stackdiff hunks\` for the ids.`);
  return hunk;
}

async function saveBaseBranch(store: Store, base: string) {
  await resolveBase(store.root, base);
  store.writeJSON("config.json", { ...store.config(), base });
}

function takeUndeliveredReviews(store: Store) {
  const nothingToTake = store.review().reviews.every((r) => r.delivered);
  if (nothingToTake) return [];
  return store.updateReview((s) => review.takeUndelivered(s));
}

async function restartServerIfDown(store: Store) {
  if (!(await findServer(store))) await ensureServer(store);
}

function answerThreads(store: Store, ids: string[], message: string | undefined, { resolve }: { resolve: boolean }) {
  store.updateReview((s) => {
    const threads = ids.map((id) => review.findThread(s.comments, id));
    const at = new Date().toISOString();
    for (const thread of threads) {
      if (message?.trim()) review.addAgentMessage(thread, message, at);
      if (resolve) review.setStatus(thread, "resolved");
    }
  });
}

// Runs outside any repo, so it takes no Store.
function printInstalledSkill() {
  for (const { path, status } of installSkill()) console.log(`${status}: ${path}`);
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name === "help" || name === "--help" || name === "-h") return console.log(HELP);
  if (name === "install-skill") return printInstalledSkill();

  if (!Object.hasOwn(commands, name)) throw new Error(`Unknown command "${name}".\n\n${HELP}`);
  const command = commands[name]!;
  const args = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true });
  await command(new Store(process.cwd()), args);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
