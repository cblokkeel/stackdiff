import { describe, expect, test } from "bun:test";
import { sinceFile } from "../src/since";
import type { ViewFile } from "../src/types";

const file = (additions: [number, number][]) =>
  ({ path: "a.ts", status: "modified", ranges: { additions, deletions: [] } }) as unknown as ViewFile;

// From the approved copy to the file now: one change near the top, one far below.
const RAW = `diff --git a/snap b/a.ts
--- a/snap
+++ b/a.ts
@@ -2,3 +2,3 @@
 a
-b
+B
 c
@@ -40,3 +40,3 @@
 x
-y
+Y
 z
`;

describe("sinceFile", () => {
  test("keeps only hunks inside the chunk, names the patch after the file, and stops expanding", () => {
    const since = sinceFile(file([[1, 10]]), { blob: "x", ranges: [[1, 10]] }, RAW);
    expect(since.patch).toBe("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2,3 +2,3 @@\n a\n-b\n+B\n c\n");
    expect(since.expandable).toBe(false);
  });

  test("a removed line counts when the chunk held it then, an added one when it holds it now", () => {
    expect(sinceFile(file([]), { blob: "x", ranges: [[41, 41]] }, RAW).patch).toContain("-y");
    expect(sinceFile(file([[41, 41]]), { blob: "x", ranges: [] }, RAW).patch).toContain("+Y");
  });

  test("expands when every change in the file is in the chunk", () => {
    expect(sinceFile(file([[1, 50]]), { blob: "x", ranges: [[1, 50]] }, RAW).expandable).toBe(true);
  });

  test("empty when nothing changed in the chunk", () => {
    expect(sinceFile(file([[20, 30]]), { blob: "x", ranges: [[20, 30]] }, RAW).patch).toBe("");
    expect(sinceFile(file([[1, 99]]), { blob: "x", ranges: [[1, 99]] }, "").patch).toBe("");
  });
});
