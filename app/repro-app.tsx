"use client";

import { useMemo, useRef, useState } from "react";
import type { PublicConfig } from "@/src/agent/public-config";
import type { AgentEvent, FinalReport, LLMCallRecord, RunRecord, StepId, StepStatus } from "@/src/agent/types";

type Mode = "example" | "url" | "text";
type Tab = "summary" | "test" | "patch" | "runs" | "pr";

interface StepState {
  id: StepId;
  status: StepStatus;
  title: string;
  detail?: string;
  startedAt: number;
  endedAt?: number;
  logs: string[];
  calls: LLMCallRecord[];
  runs: RunRecord[];
}

const STEP_ORDER: { id: StepId; label: string }[] = [
  { id: "intake", label: "Read report" },
  { id: "workspace", label: "Workspace" },
  { id: "triage", label: "Triage" },
  { id: "search", label: "Known issues" },
  { id: "context", label: "Code context" },
  { id: "repro", label: "Failing test" },
  { id: "patch", label: "Patch" },
  { id: "regression", label: "Full suite" },
  { id: "report", label: "PR draft" },
];

const VERDICT_TEXT: Record<FinalReport["verdict"], { label: string; tone: string }> = {
  "reproduced-and-fixed": { label: "Reproduced and fixed", tone: "ok" },
  "reproduced-only": { label: "Reproduced, no verified fix", tone: "warn" },
  "not-reproduced": { label: "Not reproduced", tone: "warn" },
  error: { label: "Stopped with an error", tone: "bad" },
};

function sleep(msec: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, msec);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

function ms(n?: number) {
  if (n === undefined) return "";
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="code diff">
      {diff.split("\n").map((line, i) => {
        const cls =
          line.startsWith("+++") || line.startsWith("---")
            ? "d-file"
            : line.startsWith("@@")
              ? "d-hunk"
              : line.startsWith("+")
                ? "d-add"
                : line.startsWith("-")
                  ? "d-del"
                  : "";
        return (
          <span key={i} className={`d-line ${cls}`}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function ReproApp({ config }: { config: PublicConfig }) {
  const [mode, setMode] = useState<Mode>("example");
  const [example, setExample] = useState(config.examples[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [testCode, setTestCode] = useState<{ path: string; code: string; attempt: number } | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [report, setReport] = useState<FinalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [selected, setSelected] = useState<StepId | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const replay = config.replay;
  const allRuns = useMemo(() => Object.values(steps).flatMap((s) => s.runs), [steps]);

  function apply(ev: AgentEvent) {
    if (ev.type === "step") {
      setSteps((prev) => {
        const cur = prev[ev.id];
        const done = ev.status !== "running";
        return {
          ...prev,
          [ev.id]: {
            id: ev.id,
            status: ev.status,
            title: ev.title,
            detail: ev.detail,
            startedAt: cur?.startedAt ?? ev.at,
            endedAt: done ? ev.at : undefined,
            logs: cur?.logs ?? [],
            calls: cur?.calls ?? [],
            runs: cur?.runs ?? [],
          },
        };
      });
      if (ev.status === "running") setSelected(ev.id);
    } else if (ev.type === "log" || ev.type === "llm" || ev.type === "run") {
      setSteps((prev) => {
        const cur = prev[ev.step];
        if (!cur) return prev;
        const next = { ...cur };
        if (ev.type === "log") next.logs = [...cur.logs, ev.text];
        if (ev.type === "llm") next.calls = [...cur.calls, ev.call];
        if (ev.type === "run") next.runs = [...cur.runs, ev.run];
        return { ...prev, [ev.step]: next };
      });
    } else if (ev.type === "test") {
      setTestCode({ path: ev.path, code: ev.code, attempt: ev.attempt });
    } else if (ev.type === "diff") {
      setDiff(ev.diff);
    } else if (ev.type === "result") {
      setReport(ev.report);
      if (ev.report.verdict === "reproduced-and-fixed") setTab("patch");
    } else if (ev.type === "error") {
      setError(ev.message);
    }
  }

  async function start() {
    setRunning(true);
    setSteps({});
    setTestCode(null);
    setDiff(null);
    setReport(null);
    setError(null);
    setTab("summary");
    setSelected(null);
    const body = mode === "example" ? { example } : mode === "url" ? { url } : { text, repoUrl };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (replay) {
        await playRecording(controller.signal);
        return;
      }
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) apply(JSON.parse(line) as AgentEvent);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  async function playRecording(signal: AbortSignal) {
    const res = await fetch(`/replay/${encodeURIComponent(example)}.ndjson`, { signal });
    if (!res.ok) throw new Error(`Recording not found: ${res.status}`);
    const events = (await res.text())
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as AgentEvent);
    let prev = events[0]?.at ?? 0;
    for (const ev of events) {
      // 원래 간격 유지, 화면에서 읽을 수 있는 하한과 지루하지 않은 상한 기준
      await sleep(Math.min(Math.max(ev.at - prev, 350), 1600), signal);
      prev = ev.at;
      apply(ev);
    }
  }

  const inputReady =
    mode === "example" ? Boolean(example) : mode === "url" ? /github\.com\/.+\/issues\/\d+/.test(url) : Boolean(text.trim() && repoUrl.trim());
  const canStart = !running && inputReady && (!replay || mode === "example");
  const selectedStep = selected ? steps[selected] : null;
  const verdict = report ? VERDICT_TEXT[report.verdict] : null;
  const fastModel = config.models.find((m) => m.role === "fast");
  const reasonModel = config.models.find((m) => m.role === "reason");

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M4 6h10M4 12h16M4 18h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
              <circle cx="18" cy="6" r="2.4" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-name">ReproPilot</span>
          <span className="brand-tag">Execution-verified bug reproductions</span>
        </div>
        <div className="badges">
          {replay && <span className="badge badge-replay">Replay of a recorded run</span>}
          <span className={`badge ${config.mockLLM ? "badge-warn" : "badge-ok"}`}>
            {config.mockLLM ? "Scripted model responses (MOCK_LLM=1)" : "Nemotron on Token Factory"}
          </span>
          <span className="badge">Runner: {config.runner === "nebius" ? "Nebius Sandboxes" : config.runner}</span>
          <span className="badge">{config.tavily ? "Tavily on" : "Tavily off"}</span>
        </div>
      </header>

      <main className="main">
        <section className="intro">
          <h1>From bug report to a failing test and a fix, proven by running them.</h1>
          <p>
            ReproPilot reads an issue, writes a minimal test, and runs it in an isolated sandbox. It only reports a
            reproduction when the test fails for the reported reason, then proposes a patch and keeps it only if the
            test and the full suite pass.
          </p>
          {replay && (
            <p className="replay-note">
              This hosted page replays a run recorded on {replay.recordedAt.slice(0, 10)}. The {replay.testRuns} test runs in it were
              executed for real by pytest on the {replay.runner} runner.{" "}
              {replay.scriptedModel
                ? "The model responses are hand-written fixtures (MOCK_LLM=1), not Nemotron output."
                : `The ${replay.modelCalls} model responses came from Nemotron on Nebius Token Factory.`}{" "}
              Live runs on any GitHub issue need the self-hosted server, see the{" "}
              <a href="https://github.com/hahmjuntae/repropilot#quick-start" target="_blank" rel="noreferrer">
                README
              </a>
              .
            </p>
          )}
        </section>

        <section className="card input-card">
          <div className="seg" role="tablist">
            {(
              [
                ["example", "Example issue"],
                ["url", "GitHub issue URL"],
                ["text", "Paste a report"],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={`seg-item ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
                {label}
              </button>
            ))}
          </div>
          <div className="input-row">
            {mode === "example" && (
              <select className="field" value={example} onChange={(e) => setExample(e.target.value)}>
                {config.examples.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.id}: {ex.title}
                  </option>
                ))}
              </select>
            )}
            {mode === "url" && (
              <input className="field mono" placeholder="https://github.com/owner/repo/issues/123" value={url} onChange={(e) => setUrl(e.target.value)} />
            )}
            {mode === "text" && (
              <div className="stack">
                <input className="field mono" placeholder="https://github.com/owner/repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
                <textarea className="field" rows={5} placeholder="Title on the first line, then the bug report" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
            )}
            <div className="actions">
              <button type="button" className="btn btn-primary" disabled={!canStart} onClick={start}>
                {running ? "Running" : replay ? "Play recorded run" : "Reproduce"}
              </button>
              {running && (
                <button type="button" className="btn btn-ghost" onClick={() => abortRef.current?.abort()}>
                  Stop
                </button>
              )}
            </div>
          </div>
          {replay && mode !== "example" && (
            <p className="hint">The hosted demo can only replay the recorded example. Run the server yourself to try a real issue.</p>
          )}
          {!replay && config.mockLLM && mode !== "example" && (
            <p className="hint">Scripted mode only replays bundled examples. Set NEBIUS_API_KEY to run on real issues.</p>
          )}
        </section>

        {(running || report || error || Object.keys(steps).length > 0) && (
          <div className="workspace">
            <section className="card timeline">
              <h2 className="card-title">Agent timeline</h2>
              <ol className="steps">
                {STEP_ORDER.map(({ id, label }) => {
                  const s = steps[id];
                  const status = s?.status ?? "pending";
                  return (
                    <li key={id}>
                      <button type="button" className={`step st-${status} ${selected === id ? "sel" : ""}`} onClick={() => s && setSelected(id)} disabled={!s}>
                        <span className="dot" />
                        <span className="step-body">
                          <span className="step-label">{label}</span>
                          <span className="step-title">{s ? s.title : "Waiting"}</span>
                        </span>
                        <span className="step-time">{s?.endedAt ? ms(s.endedAt - s.startedAt) : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {selectedStep && (
                <div className="step-detail">
                  {selectedStep.detail && <p className="detail-text">{selectedStep.detail}</p>}
                  {selectedStep.calls.map((c, i) => (
                    <div key={i} className="kv">
                      <span className="mono">{c.model}</span>
                      <span>
                        {c.purpose} {c.mock ? "(scripted)" : ""} {ms(c.durationMs)}
                        {c.completionTokens ? `, ${c.completionTokens} tokens` : ""}
                      </span>
                    </div>
                  ))}
                  {selectedStep.logs.length > 0 && <pre className="code small">{selectedStep.logs.join("\n")}</pre>}
                </div>
              )}
            </section>

            <section className="card results">
              {verdict && report && (
                <div className={`verdict v-${verdict.tone}`}>
                  <strong>{verdict.label}</strong>
                  <span>
                    {report.repo} with {report.framework || "unknown framework"} in {ms(report.durationMs)}
                  </span>
                </div>
              )}
              {error && <div className="verdict v-bad">{error}</div>}
              <div className="tabs" role="tablist">
                {(
                  [
                    ["summary", "Summary"],
                    ["test", "Failing test"],
                    ["patch", "Patch"],
                    ["runs", `Runs (${allRuns.length})`],
                    ["pr", "PR draft"],
                  ] as [Tab, string][]
                ).map(([t, label]) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === "summary" && (
                <div className="pane">
                  <dl className="facts">
                    <dt>Issue</dt>
                    <dd>{report?.issueTitle || steps.intake?.detail || "..."}</dd>
                    <dt>Triage</dt>
                    <dd>{steps.triage?.status === "done" ? steps.triage.detail : "..."}</dd>
                    <dt>Reproduction</dt>
                    <dd>{steps.repro?.detail ?? "..."}</dd>
                    <dt>Fix</dt>
                    <dd>{report?.patch?.explanation ?? steps.patch?.detail ?? "..."}</dd>
                    <dt>Models</dt>
                    <dd className="mono small">
                      {[...new Set((report?.llmCalls ?? Object.values(steps).flatMap((s) => s.calls)).map((c) => c.model))].join(", ") || "..."}
                    </dd>
                  </dl>
                  {report && report.searchHits.length > 0 && (
                    <>
                      <h3 className="pane-title">Related reports (Tavily)</h3>
                      <ul className="hits">
                        {report.searchHits.map((h) => (
                          <li key={h.url}>
                            <a href={h.url} target="_blank" rel="noreferrer">
                              {h.title}
                            </a>
                            <p>{h.snippet}</p>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {tab === "test" && (
                <div className="pane">
                  {testCode ? (
                    <>
                      <div className="pane-head">
                        <span className="mono">{testCode.path}</span>
                        <span className="muted">attempt {testCode.attempt}</span>
                        <CopyButton text={testCode.code} />
                      </div>
                      <pre className="code">{testCode.code}</pre>
                    </>
                  ) : (
                    <p className="muted">No test yet.</p>
                  )}
                </div>
              )}

              {tab === "patch" && (
                <div className="pane">
                  {report?.patch || diff ? (
                    <>
                      <div className="pane-head">
                        <span className="muted">Unified diff, ready for git apply</span>
                        <CopyButton text={report?.patch?.diff ?? diff ?? ""} />
                      </div>
                      <DiffView diff={report?.patch?.diff ?? diff ?? ""} />
                    </>
                  ) : (
                    <p className="muted">No patch yet.</p>
                  )}
                </div>
              )}

              {tab === "runs" && (
                <div className="pane">
                  {allRuns.length === 0 && <p className="muted">No runs yet.</p>}
                  {allRuns.map((r, i) => (
                    <details key={i} className="run" open={i === allRuns.length - 1}>
                      <summary>
                        <span className={`pill p-${r.verdict ?? "none"}`}>{r.verdict ?? `exit ${r.exitCode}`}</span>
                        <span className="run-label">{r.label}</span>
                        <span className="muted">
                          exit {r.exitCode}, {ms(r.durationMs)}, {r.runner}
                        </span>
                      </summary>
                      <pre className="code small">{`$ ${r.command}\n\n${r.output}`}</pre>
                    </details>
                  ))}
                </div>
              )}

              {tab === "pr" && (
                <div className="pane">
                  {report?.prDraft ? (
                    <>
                      <div className="pane-head">
                        <strong>{report.prDraft.title}</strong>
                        <CopyButton text={`${report.prDraft.title}\n\n${report.prDraft.body}`} />
                      </div>
                      <pre className="code prose">{report.prDraft.body}</pre>
                    </>
                  ) : (
                    <p className="muted">A PR draft appears once the patch passes the full suite.</p>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <footer className="footer">
        <span>
          Triage: <span className="mono">{fastModel?.id}</span>
        </span>
        <span>
          Tests and patches: <span className="mono">{reasonModel?.id}</span>
        </span>
        <span>Served by Nebius Token Factory. MIT licensed.</span>
      </footer>
    </div>
  );
}
