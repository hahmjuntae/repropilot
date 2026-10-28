import type { ChatMessage } from "./llm";
import type { Issue, ReproTest, Triage } from "./types";

export interface SourceFile {
  path: string;
  content: string;
}

const files = (list: SourceFile[]) =>
  list.map((f) => `--- ${f.path}\n${f.content}`).join("\n\n") || "(none)";

export function triagePrompt(issue: Issue, tree: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You triage bug reports for a coding agent. Reply with one JSON object only. " +
        'Keys: "summary" (one sentence), "language" ("python" | "javascript" | "typescript" | "unknown"), ' +
        '"expected", "actual", "symbols" (function or class names involved), ' +
        '"suspectFiles" (paths from the file tree most likely to contain the bug), ' +
        '"searchQuery" (a short web query for known reports of this error).',
    },
    {
      role: "user",
      content: `Issue title: ${issue.title}\n\nIssue body:\n${issue.body}\n\nRepository file tree:\n${tree.join("\n")}`,
    },
  ];
}

export function reproPrompt(args: {
  issue: Issue;
  triage: Triage;
  framework: string;
  sources: SourceFile[];
  exampleTests: SourceFile[];
  feedback?: string;
}): ChatMessage[] {
  const { issue, triage, framework, sources, exampleTests, feedback } = args;
  return [
    {
      role: "system",
      content:
        `You write minimal regression tests that reproduce bug reports. The test framework is ${framework}. ` +
        "Write one new test file that FAILS on the current code because of the reported bug and will PASS once the bug is fixed. " +
        "Import the code the same way the existing tests do. Do not modify existing files. Keep the test small and deterministic. " +
        'Reply with one JSON object only. Keys: "testPath" (new file path relative to the repo root), "testCode", ' +
        '"rationale" (one sentence), "expectedFailure" (what the failure output should show).',
    },
    {
      role: "user",
      content: [
        `Issue: ${issue.title}\n\n${issue.body}`,
        `Triage: ${JSON.stringify(triage)}`,
        `Relevant source files:\n${files(sources)}`,
        `Existing tests for style reference:\n${files(exampleTests)}`,
        feedback ? `Your previous attempt was rejected after running it:\n${feedback}\nFix the test.` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

export function patchPrompt(args: {
  issue: Issue;
  test: ReproTest;
  failingOutput: string;
  sources: SourceFile[];
  feedback?: string;
}): ChatMessage[] {
  const { issue, test, failingOutput, sources, feedback } = args;
  return [
    {
      role: "system",
      content:
        "You fix bugs with the smallest correct change. A test that reproduces the bug is given with its failing output. " +
        "Change source files only, never the test. Each edit replaces an exact, unique snippet of the current file. " +
        'Reply with one JSON object only. Keys: "explanation" (two sentences at most), ' +
        '"edits" (array of {"path", "search", "replace"}; "search" must match the file exactly once).',
    },
    {
      role: "user",
      content: [
        `Issue: ${issue.title}\n\n${issue.body}`,
        `Reproduction test (${test.testPath}):\n${test.testCode}`,
        `Failing output:\n${failingOutput.slice(-6000)}`,
        `Source files:\n${files(sources)}`,
        feedback ? `Your previous patch was rejected:\n${feedback}\nTry again.` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}
