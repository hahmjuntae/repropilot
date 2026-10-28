// 호스팅 데모가 재생할 실행 기록 생성 대상, MOCK_LLM 여부와 무관
// 실행 기준: npm run record:replay -- --example batchkit
import "./load-env";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PROJECT_ROOT } from "../src/agent/config";
import { runRepro } from "../src/agent/pipeline";
import { getPublicConfig } from "../src/agent/public-config";
import type { AgentEvent } from "../src/agent/types";

const OUT_DIR = path.join(PROJECT_ROOT, "public", "replay");

async function main() {
  const i = process.argv.indexOf("--example");
  const example = i > -1 ? process.argv[i + 1] : "batchkit";
  const events: AgentEvent[] = [];
  const report = await runRepro({ example }, (ev) => events.push(ev));

  const tmp = await fs.realpath(os.tmpdir());
  // 로컬 경로가 공개 기록에 남지 않도록 치환 우선
  const scrub = (text: string) =>
    text
      .split(`'${path.join(PROJECT_ROOT, ".venv", "bin", "python")}'`).join("python")
      .split(path.join(PROJECT_ROOT, ".venv", "bin", "python")).join("python")
      .split(tmp).join("/tmp")
      .split(os.tmpdir()).join("/tmp")
      .split(PROJECT_ROOT).join(".");
  const lines = events.map((ev) => scrub(JSON.stringify(ev)));

  const config = await getPublicConfig();
  const meta = {
    ...config,
    examples: config.examples.filter((e) => e.id === example),
    replay: {
      example,
      recordedAt: new Date().toISOString(),
      verdict: report.verdict,
      runner: report.runner,
      scriptedModel: report.llmCalls.some((c) => c.mock),
      modelCalls: report.llmCalls.length,
      testRuns: report.runs.length,
    },
  };
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, `${example}.ndjson`), `${lines.join("\n")}\n`);
  await fs.writeFile(path.join(OUT_DIR, "config.json"), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`Recorded ${events.length} events, verdict ${report.verdict}, scripted model: ${meta.replay.scriptedModel}`);
  if (report.verdict !== "reproduced-and-fixed") process.exit(1);
}

main();
