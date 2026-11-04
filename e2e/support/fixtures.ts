import { readFileSync } from "node:fs";
import path from "node:path";

// Where the setup project leaves signed-in browser state and the ids of the
// throwaway data it created. Gitignored; regenerated on every run.
export const AUTH_DIR = path.join(__dirname, "..", ".auth");
export const FIXTURES_FILE = path.join(AUTH_DIR, "fixtures.json");

export const storageStateFor = (user: "ownerA" | "memberA" | "ownerB") => path.join(AUTH_DIR, `${user}.json`);

export type Workspace = { name: string; slug: string; leadId: string; leadName: string };
export type Fixtures = { runId: string; alpha: Workspace; bravo: Workspace };

export function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
}
