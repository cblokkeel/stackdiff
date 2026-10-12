import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SKILL_DIR = join(import.meta.dir, "..", "skills", "stackdiff");

// Agent homes that load skills from <home>/skills/<name>/SKILL.md.
const AGENT_HOMES = [".claude", ".agents"];

export type InstallResult = { path: string; status: "linked" | "replaced" | "already linked" };

// Links the skill into every agent home that exists, so edits in this repo reach the agents at once.
export function installSkill(home = homedir(), source = SKILL_DIR): InstallResult[] {
  const homes = AGENT_HOMES.map((dir) => join(home, dir)).filter((dir) => existsSync(dir));
  if (!homes.length) throw new Error(`No agent home found. Looked for ${AGENT_HOMES.map((d) => `~/${d}`).join(", ")}.`);

  return homes.map((agentHome) => {
    const path = join(agentHome, "skills", "stackdiff");
    const existing = lstatSync(path, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink() && readlinkSync(path) === source) return { path, status: "already linked" };

    if (existing) rmSync(path, { recursive: true, force: true });
    mkdirSync(join(agentHome, "skills"), { recursive: true });
    symlinkSync(source, path, "dir");
    return { path, status: existing ? "replaced" : "linked" };
  });
}
