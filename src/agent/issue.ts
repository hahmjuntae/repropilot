import fs from "node:fs/promises";
import path from "node:path";
import { EXAMPLES_DIR } from "./config";
import type { Issue, IssueInput } from "./types";

const ISSUE_URL = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/i;
const REPO_URL = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export function parseRepoUrl(url: string): { owner: string; name: string } | null {
  const m = url.trim().match(REPO_URL) ?? url.trim().match(ISSUE_URL);
  return m ? { owner: m[1], name: m[2] } : null;
}

export async function listExamples(): Promise<{ id: string; title: string }[]> {
  const entries = await fs.readdir(EXAMPLES_DIR, { withFileTypes: true });
  const out: { id: string; title: string }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const md = await fs.readFile(path.join(EXAMPLES_DIR, e.name, "ISSUE.md"), "utf8");
      out.push({ id: e.name, title: md.split("\n")[0].replace(/^#\s*/, "") });
    } catch {
      continue;
    }
  }
  return out;
}

async function loadExample(id: string): Promise<Issue> {
  if (!/^[\w-]+$/.test(id)) throw new Error("Invalid example id");
  const md = await fs.readFile(path.join(EXAMPLES_DIR, id, "ISSUE.md"), "utf8");
  const [first, ...rest] = md.split("\n");
  return { title: first.replace(/^#\s*/, ""), body: rest.join("\n").trim(), repo: null, exampleId: id };
}

async function fetchGitHubIssue(url: string): Promise<Issue> {
  const m = url.match(ISSUE_URL);
  if (!m) throw new Error("Expected a GitHub issue URL like https://github.com/owner/repo/issues/123");
  const [, owner, name, number] = m;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "repropilot" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}/issues/${number}`, { headers });
  if (!res.ok) throw new Error(`GitHub issue fetch failed: ${res.status}`);
  const json = (await res.json()) as { title: string; body: string | null; html_url: string };
  return { title: json.title, body: json.body ?? "", url: json.html_url, repo: { owner, name } };
}

export async function resolveIssue(input: IssueInput): Promise<Issue> {
  if (input.example) return loadExample(input.example);
  if (input.url) return fetchGitHubIssue(input.url.trim());
  if (input.text?.trim()) {
    const repo = input.repoUrl ? parseRepoUrl(input.repoUrl) : null;
    if (!repo) throw new Error("A pasted bug report needs the GitHub repository URL as well.");
    const [first, ...rest] = input.text.trim().split("\n");
    return { title: first.replace(/^#\s*/, "").slice(0, 200), body: rest.join("\n").trim() || first, repo };
  }
  throw new Error("Provide a GitHub issue URL, a bug report with a repository URL, or pick the example.");
}
