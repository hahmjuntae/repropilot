export interface RunRequest {
  workdir: string;
  command: string;
  env?: Record<string, string>;
  timeoutSec: number;
}

export interface RunResult {
  exitCode: number;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

export interface Runner {
  readonly name: string;
  readonly description: string;
  readonly python: string;
  readonly installsDependencies: boolean;
  prepare?(workdir: string, installCommand: string, timeoutSec: number): Promise<RunResult>;
  run(req: RunRequest): Promise<RunResult>;
}

export const MAX_OUTPUT_CHARS = 60000;

export function clampOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const head = text.slice(0, MAX_OUTPUT_CHARS / 2);
  const tail = text.slice(-MAX_OUTPUT_CHARS / 2);
  return `${head}\n\n[... ${text.length - MAX_OUTPUT_CHARS} characters truncated ...]\n\n${tail}`;
}
