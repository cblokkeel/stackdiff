import { expect, test } from "bun:test";
import { parseDiff } from "../src/git";
import {
  applyMoves,
  buildChunks,
  checkPlan,
  followCode,
  locateComments,
  parsePlan,
  snippetFor,
  UNPLANNED_TITLE,
} from "../src/plan";
import type { Comment, ReviewState } from "../src/types";

const DIFF = `diff --git a/src/math.ts b/src/math.ts
index 1111111..2222222 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,3 +1,4 @@
+export type Num = number;
 export function add(a, b) {
   return a + b;
 }
@@ -20,3 +21,6 @@ export function sub(a, b) {
   return a - b;
 }
+export function mul(a, b) {
+  return a * b;
+}
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
diff --git a/old.md b/new.md
similarity index 100%
rename from old.md
rename to new.md
diff --git a/logo.png b/logo.png
index 4444444..5555555 100644
Binary files a/logo.png and b/logo.png differ
`;

const empty: ReviewState = { comments: [], reviews: [], reviewed: {}, nextComment: 1, chat: [], nextChat: 1 };
const files = parseDiff(DIFF);

test("parses files, statuses and hunk ids", () => {
  expect(files.map((f) => [f.path, f.status, f.hunks.map((h) => h.id)])).toEqual([
    ["src/math.ts", "modified", ["src/math.ts#1", "src/math.ts#2"]],
    ["src/new.ts", "added", ["src/new.ts#1"]],
    ["new.md", "renamed", ["new.md#1"]],
    ["logo.png", "binary", ["logo.png#1"]],
  ]);
  expect(files[0]!.hunks[1]).toMatchObject({ added: 3, removed: 0, oldStart: 20, newStart: 21 });
  expect(files[2]!.oldPath).toBe("old.md");
});

test("checkPlan reports unknown, doubled and missing hunks", () => {
  const errors = checkPlan(
    {
      chunks: [
        { title: "A", hunks: ["src/math.ts", "nope.ts"] },
        { title: "B", hunks: ["src/math.ts#2"] },
      ],
    },
    files,
  );
  expect(errors).toEqual([
    'Chunk 1 ("A"): unknown hunk or file "nope.ts".',
    'src/math.ts#2 is in both "A" and "B".',
    "Hunks not in any chunk: src/new.ts#1, new.md#1, logo.png#1",
  ]);
});

test("parsePlan keeps a markdown overview and rejects any other type", () => {
  const plan = parsePlan(JSON.stringify({ overview: "# Why\n\nBecause.", chunks: [] }));
  expect(plan.overview).toBe("# Why\n\nBecause.");
  expect(() => parsePlan(JSON.stringify({ overview: ["# Why"], chunks: [] }))).toThrow(
    '"overview" must be a markdown string.',
  );
});

test("parsePlan checks screenshots, and chunks point at the stored copies", () => {
  const bad = (screenshots: unknown) => JSON.stringify({ chunks: [{ title: "UI", hunks: [], screenshots }] });
  const message = 'Chunk 1 ("UI"): "screenshots" must be an array of { "path", "caption" }.';
  expect(() => parsePlan(bad("shot.png"))).toThrow(message);
  expect(() => parsePlan(bad([{ caption: "no path" }]))).toThrow(message);
  expect(() => parsePlan(bad([{ path: "a.png", caption: 3 }]))).toThrow(message);

  const shots = [{ path: "abc.png", caption: "After: empty state" }, { path: "d e.png" }];
  const [chunk] = buildChunks({ chunks: [{ title: "UI", hunks: ["src/math.ts"], screenshots: shots }] }, files, empty);
  expect(chunk!.screenshots).toEqual([
    { url: "/api/images/abc.png", caption: "After: empty state" },
    { url: "/api/images/d%20e.png", caption: "" },
  ]);
});

test("a file can be split across chunks, leftovers go to Not in plan", () => {
  const chunks = buildChunks(
    {
      chunks: [
        { title: "Types", hunks: ["src/math.ts#1"] },
        { title: "Mul", hunks: ["src/math.ts#2", "src/new.ts"] },
      ],
    },
    files,
    empty,
  );
  expect(chunks.map((c) => [c.title, c.files.map((f) => f.hunkIds)])).toEqual([
    ["Types", [["src/math.ts#1"]]],
    ["Mul", [["src/math.ts#2"], ["src/new.ts#1"]]],
    [UNPLANNED_TITLE, [["new.md#1"], ["logo.png#1"]]],
  ]);
  const typesPatch = chunks[0]!.files[0]!.patch;
  expect(typesPatch).toContain("+export type Num");
  expect(typesPatch).not.toContain("mul");
  expect(chunks[2]!.files[0]!.note).toContain("Renamed from old.md");
});

test("reviewed mark clears when chunk content changes", () => {
  const plan = { chunks: [{ title: "All", hunks: ["src/math.ts", "src/new.ts", "new.md", "logo.png"] }] };
  const [c] = buildChunks(plan, files, empty);
  const review = { ...empty, reviewed: { All: c!.hash } };
  expect(buildChunks(plan, files, review)[0]!.reviewed).toBe(true);
  expect(buildChunks(plan, files, review)[0]!.changedSinceApproval).toBe(false);
  const changed = parseDiff(DIFF.replace("return a * b;", "return a * b * 1;"));
  expect(buildChunks(plan, changed, review)[0]!.reviewed).toBe(false);
  expect(buildChunks(plan, changed, review)[0]!.changedSinceApproval).toBe(true);
  expect(buildChunks(plan, changed, empty)[0]!.changedSinceApproval).toBe(false);
});

test("comments map to the chunk that shows their line", () => {
  const chunks = buildChunks(
    {
      chunks: [
        { title: "Types", hunks: ["src/math.ts#1"] },
        { title: "Rest", hunks: ["src/math.ts#2"] },
      ],
    },
    files,
    empty,
  );
  const base: Omit<Comment, "endLine" | "id"> = {
    kind: "change",
    file: "src/math.ts",
    side: "additions",
    startLine: 1,
    snippet: "",
    chunkTitle: "",
    status: "open",
    messages: [],
    createdAt: "",
  };
  const located = locateComments(
    [
      { ...base, id: "c1", endLine: 1 },
      { ...base, id: "c2", endLine: 24 },
      { ...base, id: "c3", endLine: 99 },
    ],
    chunks,
  );
  expect(located.map((c) => c.chunkKey)).toEqual(["Types", "Rest", null]);
  expect(snippetFor(files, "src/math.ts", "additions", 23, 25)).toBe(
    "+export function mul(a, b) {\n+  return a * b;\n+}",
  );
});

const newFile = (lines: string[]) =>
  parseDiff(
    `diff --git a/a.ts b/a.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/a.ts
@@ -0,0 +1,${lines.length} @@
${lines.map((l) => "+" + l).join("\n")}
`,
  );

const thread = (startLine: number, endLine: number, snippet: string): Comment => ({
  id: "c1",
  kind: "change",
  file: "a.ts",
  side: "additions",
  startLine,
  endLine,
  snippet,
  chunkTitle: "",
  status: "open",
  messages: [],
  createdAt: "",
});

test("a thread stays put while its code does", () => {
  const files = newFile(["one", "two", "three"]);
  expect(followCode([thread(2, 2, "+two")], files)).toEqual([]);
});

test("a thread follows its code when lines above it go away", () => {
  const files = newFile(["two", "three", "x"]);
  const c = thread(2, 3, "+two\n+three");
  const moves = followCode([c], files);
  expect(moves).toEqual([{ id: "c1", startLine: 1, endLine: 2, codeChanged: false }]);
  applyMoves([c], moves);
  expect(c).toMatchObject({ startLine: 1, endLine: 2 });
  expect(followCode([c], files)).toEqual([]);
});

test("of several copies, a thread goes to the one nearest where it was", () => {
  const files = newFile(["}", "a", "}", "b", "}"]);
  expect(followCode([thread(4, 4, "+}")], files)).toEqual([{ id: "c1", startLine: 3, endLine: 3, codeChanged: false }]);
});

test("a thread whose code was rewritten stays near its line and says so", () => {
  const files = newFile(["one", "TWO"]);
  const c = thread(9, 9, "+two");
  const moves = followCode([c], files);
  expect(moves).toEqual([{ id: "c1", startLine: 2, endLine: 2, codeChanged: true }]);
  applyMoves([c], moves);
  expect(c.codeChanged).toBe(true);
  expect(followCode([c], files)).toEqual([]);
  expect(followCode([thread(1, 2, "+one\n+two")], files)).toEqual([
    { id: "c1", startLine: 1, endLine: 2, codeChanged: true },
  ]);
  const restored = followCode([c], newFile(["one", "two"]));
  expect(restored).toEqual([{ id: "c1", startLine: 2, endLine: 2, codeChanged: false }]);
});

test("a thread with no snippet, or whose file left the diff, keeps its lines", () => {
  expect(followCode([thread(5, 5, "")], newFile(["one"]))).toEqual([]);
  expect(followCode([{ ...thread(5, 5, "+one"), file: "gone.ts" }], newFile(["one"]))).toEqual([]);
});
