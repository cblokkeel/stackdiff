import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
import { useEffect } from "react";
import type { ViewChunk } from "../src/types";

// Parsing a patch once and giving it a cache key lets the worker pool keep its
// highlighted result, so a chunk colored ahead of time renders without waiting.
const parsedByPatch = new Map<string, FileDiffMetadata>();

export function fileDiffFor(patch: string): FileDiffMetadata {
  let parsed = parsedByPatch.get(patch);
  if (!parsed) {
    parsed = parsePatchFiles(patch, `p${parsedByPatch.size}`)[0]!.files[0]!;
    parsedByPatch.set(patch, parsed);
  }
  return parsed;
}

const hasIdleCallback = typeof requestIdleCallback === "function";
const whenIdle = (run: () => void) =>
  hasIdleCallback ? requestIdleCallback(run, { timeout: 1000 }) : window.setTimeout(run, 200);
const cancelIdle = (id: number) => (hasIdleCallback ? cancelIdleCallback(id) : window.clearTimeout(id));

export function useHighlightNeighbours(chunks: ViewChunk[], index: number) {
  const pool = useWorkerPool();
  useEffect(() => {
    if (!pool) return;
    const id = whenIdle(() => {
      for (const chunk of [chunks[index + 1], chunks[index - 1]]) {
        for (const file of chunk?.files ?? []) {
          if (file.patch) pool.primeDiffHighlightCache(fileDiffFor(file.patch)).catch(() => {});
        }
      }
    });
    return () => cancelIdle(id);
  }, [pool, chunks, index]);
}
