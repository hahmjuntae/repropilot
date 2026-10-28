import fs from "node:fs/promises";
import { LIMITS } from "./config";
import { classifyRun, detectPlan, type TestPlan } from "./detect";
import { applyEdits, newFileDiff, revertEdits } from "./edits";
import { resolveIssue } from "./issue";
import { callJson } from "./llm";
import { MODEL_CATALOG, type ModelRole } from "./models";
import { patchPrompt, reproPrompt, triagePrompt, type SourceFile } from "./prompts";
import { createRunner, type Runner } from "./runners";
import { searchKnownIssues } from "./tavily";
import type {
  Emit,
  FinalReport,
  Issue,
  IssueInput,
  LLMCallRecord,
  PatchProposal,
  ReproTest,
  RunRecord,
  SearchHit,
  StepId,
  StepStatus,
  Triage,
} from "./types";
import { createWorkspace, listFiles, readText, removeWorkspace, safeJoin, writeText } from "./workspace";

interface Ctx {
  emit: Emit;
  runner: Runner;
  runs: RunRecord[];
  llmCalls: LLMCallRecord[];
}

const now = () => Date.now();

function step(ctx: Ctx, id: StepId, status: StepStatus, title: string, detail?: string) {
  ctx.emit({ type: "step", id, status, title, detail, at: now() });
}

function log(ctx: Ctx, stepId: StepId, text: string) {
  ctx.emit({ type: "log", step: stepId, text, at: now() });
}

async function llm<T>(ctx: Ctx, stepId: StepId, args: Parameters<typeof callJson>[0]): Promise<T> {
  log(ctx, stepId, `Calling ${MODEL_CATALOG[args.role].id} (${args.purpose}, attempt ${args.attempt})`);
  const { data, record } = await callJson<T>(args);
  ctx.llmCalls.push(record);
  ctx.emit({ type: "llm", step: stepId, call: record, at: now() });
  return data;
}

async function exec(
  ctx: Ctx,
  stepId: StepId,
  label: string,
  workdir: string,
  plan: TestPlan,
  command: string,
  judge: (exitCode: number, output: string) => RunRecord["verdict"],
): Promise<RunRecord> {
  log(ctx, stepId, `$ ${command}`);
  const r = await ctx.runner.run({ workdir, command, env: plan.env, timeoutSec: LIMITS.testTimeoutSec });
  const record: RunRecord = { label, command, runner: ctx.runner.name, ...r, verdict: judge(r.exitCode, r.output) };
  ctx.runs.push(record);
  ctx.emit({ type: "run", step: stepId, run: record, at: now() });
  return record;
}

function normalizeTriage(raw: Partial<Triage>, tree: string[]): Triage {
  const known = new Set(tree);
  return {
    summary: String(raw.summary ?? ""),
    language: (["python", "javascript", "typescript"].includes(String(raw.language)) ? raw.language : "unknown") as Triage["language"],
    expected: String(raw.expected ?? ""),
    actual: String(raw.actual ?? ""),
    symbols: Array.isArray(raw.symbols) ? raw.symbols.map(String).slice(0, 8) : [],
    suspectFiles: Array.isArray(raw.suspectFiles) ? raw.suspectFiles.map(String).filter((f) => known.has(f)) : [],
    searchQuery: String(raw.searchQuery ?? ""),
  };
}

async function gatherSources(workdir: string, tree: string[], triage: Triage, plan: TestPlan): Promise<{ sources: SourceFile[]; tests: SourceFile[] }> {
  const sourceExt = plan.language === "python" ? /\.py$/ : /\.[cm]?[jt]sx?$/;
  const candidates = new Set(triage.suspectFiles);
  if (candidates.size < LIMITS.maxContextFiles && triage.symbols.length) {
    for (const file of tree) {
      if (candidates.size >= LIMITS.maxContextFiles) break;
      if (!sourceExt.test(file) || plan.isTestFile(file)) continue;
      const text = await readText(workdir, file);
      if (text && triage.symbols.some((s) => text.includes(s))) candidates.add(file);
    }
  }
  const sources: SourceFile[] = [];
  for (const file of [...candidates].slice(0, LIMITS.maxContextFiles)) {
    const content = await readText(workdir, file);
    if (content !== null) sources.push({ path: file, content });
  }
  const tests: SourceFile[] = [];
  for (const file of tree.filter((f) => plan.isTestFile(f)).slice(0, 2)) {
    const content = await readText(workdir, file, 4000);
    if (content !== null) tests.push({ path: file, content });
  }
  return { sources, tests };
}

function prDraft(issue: Issue, triage: Triage, test: ReproTest, patch: PatchProposal, plan: TestPlan): { title: string; body: string } {
  return {
    title: `Fix: ${issue.title}`.slice(0, 120),
    body: [
      issue.url ? `Fixes ${issue.url}` : "",
      "## Problem",
      triage.summary,
      "## Fix",
      patch.explanation,
      "## Verification",
      `- \`${test.testPath}\` fails on the current code (${test.expectedFailure}).`,
      `- The same test passes with this patch, and the full ${plan.framework} suite passes.`,
      "",
      "_Reproduced and verified by executing the tests, generated with ReproPilot (NVIDIA Nemotron on Nebius Token Factory)._",
    ]
      .filter((l) => l !== undefined)
      .join("\n"),
  };
}

/** Runs the full loop: issue → workspace → triage → failing test → patch → passing suite. */
export async function runRepro(input: IssueInput, emit: Emit): Promise<FinalReport> {
  const started = now();
  const ctx: Ctx = { emit, runner: createRunner(), runs: [], llmCalls: [] };
  const report: FinalReport = {
    verdict: "error",
    issueTitle: "",
    repo: "",
    framework: "",
    runner: ctx.runner.name,
    runs: ctx.runs,
    llmCalls: ctx.llmCalls,
    searchHits: [],
    durationMs: 0,
  };
  let workdir: string | null = null;
  let current: StepId = "intake";
  try {
    step(ctx, "intake", "running", "Reading the bug report");
    const issue = await resolveIssue(input);
    report.issueTitle = issue.title;
    report.repo = issue.exampleId ? `examples/${issue.exampleId}` : `${issue.repo!.owner}/${issue.repo!.name}`;
    step(ctx, "intake", "done", "Read the bug report", issue.title);

    current = "workspace";
    step(ctx, "workspace", "running", "Preparing an isolated workspace", report.repo);
    workdir = await createWorkspace(issue);
    const tree = await listFiles(workdir);
    const plan = await detectPlan(workdir, ctx.runner);
    report.framework = plan.framework;
    const classify = (code: number, output: string) => classifyRun(plan, code, output);
    log(ctx, "workspace", `${tree.length} files, ${plan.framework} detected, runner: ${ctx.runner.name}`);
    if (plan.install && (ctx.runner.installsDependencies || ctx.runner.prepare)) {
      log(ctx, "workspace", `$ ${plan.install}`);
      const r = ctx.runner.prepare
        ? await ctx.runner.prepare(workdir, plan.install, LIMITS.installTimeoutSec)
        : await ctx.runner.run({ workdir, command: plan.install, env: plan.env, timeoutSec: LIMITS.installTimeoutSec });
      ctx.runs.push({ label: "Install dependencies", command: plan.install, runner: ctx.runner.name, ...r });
      if (r.exitCode !== 0) log(ctx, "workspace", "Dependency install reported errors; continuing.");
    }
    step(ctx, "workspace", "done", "Workspace ready", `${plan.framework} on ${ctx.runner.name}`);

    current = "triage";
    step(ctx, "triage", "running", "Triaging the report", MODEL_CATALOG.fast.label);
    const rawTriage = await llm<Partial<Triage>>(ctx, "triage", {
      purpose: "triage",
      role: "fast",
      attempt: 1,
      exampleId: issue.exampleId,
      messages: triagePrompt(issue, tree),
      maxTokens: 1024,
    });
    const triage = normalizeTriage(rawTriage, tree);
    step(ctx, "triage", "done", "Triaged", triage.summary);

    current = "search";
    step(ctx, "search", "running", "Searching for known reports", triage.searchQuery);
    let hits: SearchHit[] | null = null;
    try {
      hits = await searchKnownIssues(triage.searchQuery);
    } catch (err) {
      log(ctx, "search", String(err));
    }
    if (hits) {
      report.searchHits = hits;
      step(ctx, "search", "done", `Found ${hits.length} related reports`, "Tavily");
    } else {
      step(ctx, "search", "skipped", "Known-issue search skipped", "Set TAVILY_API_KEY to enable");
    }

    current = "context";
    step(ctx, "context", "running", "Collecting relevant code");
    const { sources, tests } = await gatherSources(workdir, tree, triage, plan);
    step(ctx, "context", "done", `Collected ${sources.length} source files`, sources.map((s) => s.path).join(", "));

    current = "repro";
    step(ctx, "repro", "running", "Writing a failing test", MODEL_CATALOG.reason.label);
    let test: ReproTest | null = null;
    let failingRun: RunRecord | null = null;
    let feedback: string | undefined;
    for (let attempt = 1; attempt <= LIMITS.reproAttempts && !failingRun; attempt++) {
      const candidate = await llm<ReproTest>(ctx, "repro", {
        purpose: "repro",
        role: "reason",
        attempt,
        exampleId: issue.exampleId,
        messages: reproPrompt({ issue, triage, framework: plan.framework, sources, exampleTests: tests, feedback }),
      });
      safeJoin(workdir, candidate.testPath);
      if (tree.includes(candidate.testPath)) {
        feedback = `${candidate.testPath} already exists. Use a new file name.`;
        continue;
      }
      await writeText(workdir, candidate.testPath, candidate.testCode);
      ctx.emit({ type: "test", path: candidate.testPath, code: candidate.testCode, attempt, at: now() });
      const run = await exec(ctx, "repro", `Reproduction test, attempt ${attempt}`, workdir, plan, plan.testCommand(candidate.testPath), classify);
      log(ctx, "repro", `Attempt ${attempt}: ${run.verdict}`);
      if (run.verdict === "fails-as-expected") {
        test = candidate;
        failingRun = run;
      } else {
        feedback =
          run.verdict === "passes"
            ? "The test PASSED on the buggy code, so it does not reproduce the bug."
            : `The test is broken (it errors before reaching an assertion). Output:\n${run.output.slice(-3000)}`;
        await fs.rm(safeJoin(workdir, candidate.testPath), { force: true });
      }
    }
    if (!test || !failingRun) {
      step(ctx, "repro", "failed", "Could not reproduce", "No candidate test failed for the reported reason");
      report.verdict = "not-reproduced";
      return report;
    }
    step(ctx, "repro", "done", "Bug reproduced", `${test.testPath} fails as expected`);
    report.test = { path: test.testPath, code: test.testCode };

    current = "patch";
    step(ctx, "patch", "running", "Proposing a fix", MODEL_CATALOG.reason.label);
    let accepted: { proposal: PatchProposal; diff: string } | null = null;
    feedback = undefined;
    for (let attempt = 1; attempt <= LIMITS.patchAttempts && !accepted; attempt++) {
      const role: ModelRole = attempt === LIMITS.patchAttempts ? "escalate" : "reason";
      const proposal = await llm<PatchProposal>(ctx, "patch", {
        purpose: "patch",
        role,
        attempt,
        exampleId: issue.exampleId,
        messages: patchPrompt({ issue, test, failingOutput: failingRun.output, sources, feedback }),
      });
      const edits = (proposal.edits ?? []).filter((e) => e.path !== test!.testPath);
      let applied;
      try {
        applied = await applyEdits(workdir, edits);
      } catch (err) {
        feedback = String(err);
        log(ctx, "patch", `Patch rejected: ${feedback}`);
        continue;
      }
      ctx.emit({ type: "diff", diff: applied.diff, attempt, at: now() });
      const run = await exec(ctx, "patch", `Reproduction test with patch, attempt ${attempt}`, workdir, plan, plan.testCommand(test.testPath), classify);
      if (run.exitCode === 0) {
        accepted = { proposal, diff: applied.diff };
      } else {
        feedback = `The reproduction test still fails with your patch:\n${run.output.slice(-3000)}`;
        await revertEdits(workdir, applied);
      }
    }
    if (!accepted) {
      step(ctx, "patch", "failed", "No verified fix", "The failing test is still a useful bug report");
      report.verdict = "reproduced-only";
      return report;
    }
    step(ctx, "patch", "done", "Fix makes the test pass", accepted.proposal.explanation);

    current = "regression";
    step(ctx, "regression", "running", "Running the full test suite");
    const suite = await exec(ctx, "regression", "Full test suite with patch", workdir, plan, plan.testCommand(), (code) =>
      code === 0 ? "passes" : "error",
    );
    if (suite.exitCode !== 0) {
      step(ctx, "regression", "failed", "The patch breaks other tests");
      report.verdict = "reproduced-only";
      report.patch = { explanation: accepted.proposal.explanation, diff: accepted.diff };
      return report;
    }
    step(ctx, "regression", "done", "Full suite passes");

    current = "report";
    report.verdict = "reproduced-and-fixed";
    report.patch = {
      explanation: accepted.proposal.explanation,
      diff: newFileDiff(test.testPath, test.testCode) + accepted.diff,
    };
    report.prDraft = prDraft(issue, triage, test, accepted.proposal, plan);
    step(ctx, "report", "done", "Ready to open a pull request");
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    step(ctx, current, "failed", "Stopped", message);
    emit({ type: "error", message, at: now() });
    report.verdict = "error";
    return report;
  } finally {
    report.durationMs = now() - started;
    emit({ type: "result", report, at: now() });
    if (workdir && process.env.REPRO_KEEP_WORKSPACE !== "1") await removeWorkspace(workdir);
  }
}
