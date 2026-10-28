import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../config";
import { clampOutput, type Runner, type RunRequest, type RunResult } from "./types";

function resolvePython(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const venv = path.join(PROJECT_ROOT, ".venv", "bin", "python");
  return fs.existsSync(venv) ? venv : "python3";
}

const PASSTHROUGH_ENV = ["PATH", "HOME", "LANG", "TMPDIR", "SYSTEMROOT"];

export function execShell(req: RunRequest, baseEnv: NodeJS.ProcessEnv): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const env: Record<string, string> = {};
    for (const key of PASSTHROUGH_ENV) if (baseEnv[key]) env[key] = baseEnv[key] as string;
    Object.assign(env, req.env);
    const child = spawn("sh", ["-c", req.command], { cwd: req.workdir, env: env as NodeJS.ProcessEnv, detached: true });
    let output = "";
    let timedOut = false;
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, req.timeoutSec * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        output: clampOutput(output),
        durationMs: Date.now() - started,
        timedOut,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, output: String(err), durationMs: Date.now() - started, timedOut: false });
    });
  });
}

export class LocalRunner implements Runner {
  readonly name = "local";
  readonly description = "Runs tests in a temporary directory on this machine (development only, no isolation).";
  readonly python = resolvePython();
  readonly installsDependencies = process.env.REPRO_INSTALL_DEPS === "1";

  run(req: RunRequest): Promise<RunResult> {
    return execShell(req, process.env);
  }
}
