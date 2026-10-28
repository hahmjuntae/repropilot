export type StepId =
  | "intake"
  | "workspace"
  | "triage"
  | "search"
  | "context"
  | "repro"
  | "patch"
  | "regression"
  | "report";

export type StepStatus = "running" | "done" | "failed" | "skipped";

export interface RunRecord {
  label: string;
  command: string;
  runner: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  output: string;
  verdict?: "fails-as-expected" | "passes" | "broken" | "error";
}

export interface LLMCallRecord {
  purpose: string;
  model: string;
  mock: boolean;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface Triage {
  summary: string;
  language: "python" | "javascript" | "typescript" | "unknown";
  expected: string;
  actual: string;
  symbols: string[];
  suspectFiles: string[];
  searchQuery: string;
}

export interface ReproTest {
  testPath: string;
  testCode: string;
  rationale: string;
  expectedFailure: string;
}

export interface FileEdit {
  path: string;
  search: string;
  replace: string;
}

export interface PatchProposal {
  explanation: string;
  edits: FileEdit[];
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type Verdict = "reproduced-and-fixed" | "reproduced-only" | "not-reproduced" | "error";

export interface FinalReport {
  verdict: Verdict;
  issueTitle: string;
  repo: string;
  framework: string;
  runner: string;
  test?: { path: string; code: string };
  patch?: { explanation: string; diff: string };
  runs: RunRecord[];
  llmCalls: LLMCallRecord[];
  searchHits: SearchHit[];
  prDraft?: { title: string; body: string };
  durationMs: number;
}

export type AgentEvent =
  | { type: "step"; id: StepId; status: StepStatus; title: string; detail?: string; at: number }
  | { type: "log"; step: StepId; text: string; at: number }
  | { type: "llm"; step: StepId; call: LLMCallRecord; at: number }
  | { type: "run"; step: StepId; run: RunRecord; at: number }
  | { type: "test"; path: string; code: string; attempt: number; at: number }
  | { type: "diff"; diff: string; attempt: number; at: number }
  | { type: "result"; report: FinalReport; at: number }
  | { type: "error"; message: string; at: number };

export type Emit = (event: AgentEvent) => void;

export interface IssueInput {
  url?: string;
  text?: string;
  repoUrl?: string;
  example?: string;
}

export interface Issue {
  title: string;
  body: string;
  url?: string;
  repo: { owner: string; name: string } | null;
  exampleId?: string;
}
