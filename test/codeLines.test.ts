import { expect, test } from "bun:test";
import { snippetFromPatch } from "../web/codeLines";
const patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10,2 +10,3 @@\n x\n+y\n z";
test("snippetFromPatch cuts the lines of one side, with their prefix", () => {
  expect(snippetFromPatch(patch, "additions", 2, 3)).toBe("+B\n c");
  expect(snippetFromPatch(patch, "deletions", 2, 2)).toBe("-b");
  expect(snippetFromPatch(patch, "additions", 11, 12)).toBe("+y\n z");
});
