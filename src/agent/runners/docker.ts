import { execShell } from "./local";
import type { Runner, RunRequest, RunResult } from "./types";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class DockerRunner implements Runner {
  readonly name = "docker";
  readonly description = "Runs tests in a throwaway Docker container with the workspace mounted.";
  readonly python = "python";
  readonly installsDependencies = true;

  constructor(private readonly image = process.env.REPRO_DOCKER_IMAGE || "python:3.12-slim") {}

  run(req: RunRequest): Promise<RunResult> {
    const envFlags = Object.entries(req.env ?? {})
      .map(([k, v]) => `-e ${quote(`${k}=${v}`)}`)
      .join(" ");
    const command = [
      "docker run --rm",
      `-v ${quote(`${req.workdir}:/work`)}`,
      "-w /work",
      envFlags,
      quote(this.image),
      "sh -c",
      quote(req.command),
    ]
      .filter(Boolean)
      .join(" ");
    return execShell({ ...req, command, timeoutSec: req.timeoutSec + 60 }, process.env);
  }
}
