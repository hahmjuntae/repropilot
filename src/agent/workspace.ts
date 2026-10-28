import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { EXAMPLES_DIR, LIMITS } from "./config";
import type { Issue } from "./types";

const IGNORED = new Set([
  ".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", "dist", "build", ".next", "coverage",
]);

export async function createWorkspace(issue: Issue): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repropilot-"));
  if (issue.exampleId) {
    await fs.cp(path.join(EXAMPLES_DIR, issue.exampleId, "repo"), dir, { recursive: true });
    return dir;
  }
  if (!issue.repo) throw new Error("No repository to download");
  const { owner, name } = issue.repo;
  const res = await fetch(`https://codeload.github.com/${owner}/${name}/tar.gz/HEAD`);
  if (!res.ok || !res.body) throw new Error(`Repository download failed: ${res.status}`);
  const size = Number(res.headers.get("content-length") || 0);
  if (size > LIMITS.maxTarballBytes) throw new Error(`Repository archive is too large (${size} bytes)`);
  await pipeline(Readable.fromWeb(res.body as never), tar.x({ cwd: dir, strip: 1 }));
  return dir;
}

export async function removeWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function listFiles(root: string, limit = LIMITS.maxTreeEntries): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string) {
    if (out.length >= limit) return;
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= limit) return;
      if (IGNORED.has(e.name) || e.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(child);
      else out.push(child);
    }
  }
  await walk("");
  return out;
}

export function safeJoin(root: string, rel: string): string {
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Path escapes workspace: ${rel}`);
  return target;
}

export async function readText(root: string, rel: string, max = LIMITS.maxFileChars): Promise<string | null> {
  try {
    const text = await fs.readFile(safeJoin(root, rel), "utf8");
    return text.length > max ? `${text.slice(0, max)}\n[... truncated ...]` : text;
  } catch {
    return null;
  }
}

export async function writeText(root: string, rel: string, content: string): Promise<void> {
  const target = safeJoin(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}
