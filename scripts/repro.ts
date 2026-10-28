import "./load-env";
import { runRepro } from "../src/agent/pipeline";
import type { AgentEvent, IssueInput } from "../src/agent/types";

function parseArgs(argv: string[]): IssueInput {
  const input: IssueInput = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--example") input.example = argv[++i] ?? "batchkit";
    else if (arg === "--repo") input.repoUrl = argv[++i];
    else if (arg === "--text") input.text = argv[++i];
    else if (arg.startsWith("https://")) input.url = arg;
  }
  if (!input.example && !input.url && !input.text) input.example = "batchkit";
  return input;
}

function print(ev: AgentEvent) {
  switch (ev.type) {
    case "step":
      console.log(`[${ev.status.padEnd(7)}] ${ev.id.padEnd(10)} ${ev.title}${ev.detail ? ` :: ${ev.detail}` : ""}`);
      break;
    case "log":
      console.log(`            ${ev.text}`);
      break;
    case "llm":
      console.log(`            model ${ev.call.model}${ev.call.mock ? " (scripted)" : ""} ${ev.call.durationMs}ms`);
      break;
    case "run":
      console.log(`            exit ${ev.run.exitCode} in ${ev.run.durationMs}ms -> ${ev.run.verdict ?? "-"}`);
      console.log(ev.run.output.trim().split("\n").slice(-8).map((l) => `            | ${l}`).join("\n"));
      break;
    case "error":
      console.error(`ERROR ${ev.message}`);
      break;
    default:
      break;
  }
}

async function main() {
  const report = await runRepro(parseArgs(process.argv.slice(2)), print);
  console.log(`\nVerdict: ${report.verdict} (${report.durationMs}ms)`);
  if (report.patch) console.log(`\n${report.patch.diff}`);
  process.exit(report.verdict === "reproduced-and-fixed" ? 0 : 1);
}

main();
