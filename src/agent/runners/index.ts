import { runnerKind } from "../config";
import { DockerRunner } from "./docker";
import { LocalRunner } from "./local";
import { NebiusSandboxRunner } from "./nebius";
import type { Runner } from "./types";

export function createRunner(): Runner {
  switch (runnerKind()) {
    case "nebius":
      return new NebiusSandboxRunner();
    case "docker":
      return new DockerRunner();
    default:
      return new LocalRunner();
  }
}

export type { Runner, RunRequest, RunResult } from "./types";
