import { createTwoFilesPatch } from "diff";
import { readText, writeText } from "./workspace";
import type { FileEdit } from "./types";

export interface AppliedEdits {
  diff: string;
  originals: Map<string, string>;
}

/** Applies search/replace edits; each search must match exactly once so the patch is unambiguous. */
export async function applyEdits(root: string, edits: FileEdit[]): Promise<AppliedEdits> {
  if (!edits.length) throw new Error("The patch has no edits.");
  const originals = new Map<string, string>();
  const updated = new Map<string, string>();
  for (const edit of edits) {
    const current = updated.get(edit.path) ?? (await readText(root, edit.path, Number.MAX_SAFE_INTEGER));
    if (current === null) throw new Error(`File not found: ${edit.path}`);
    if (!originals.has(edit.path)) originals.set(edit.path, current);
    const count = current.split(edit.search).length - 1;
    if (count !== 1) throw new Error(`Search text in ${edit.path} matched ${count} times; it must match exactly once.`);
    updated.set(edit.path, current.replace(edit.search, () => edit.replace));
  }
  const parts: string[] = [];
  for (const [file, next] of updated) {
    await writeText(root, file, next);
    parts.push(createTwoFilesPatch(`a/${file}`, `b/${file}`, originals.get(file)!, next, "", "", { context: 3 }));
  }
  return { diff: parts.map(stripHeader).join(""), originals };
}

export async function revertEdits(root: string, applied: AppliedEdits): Promise<void> {
  for (const [file, content] of applied.originals) await writeText(root, file, content);
}

export function newFileDiff(file: string, content: string): string {
  return stripHeader(createTwoFilesPatch("/dev/null", `b/${file}`, "", content, "", "", { context: 3 }));
}

function stripHeader(patch: string): string {
  return patch.replace(/^=+\n/m, "").replace(/^Index: .*\n/m, "");
}
