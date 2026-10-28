import path from "node:path";

export const TOKEN_FACTORY_BASE_URL =
  process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1/";
export const SANDBOXES_BASE_URL =
  process.env.NEBIUS_SANDBOXES_URL || "https://api.tokenfactory.nebius.com/sandboxes/v1";

export function isMockLLM(): boolean {
  return process.env.MOCK_LLM === "1";
}

export type RunnerKind = "local" | "docker" | "nebius";

export function runnerKind(): RunnerKind {
  const v = (process.env.REPRO_RUNNER || "").toLowerCase();
  if (v === "local" || v === "docker" || v === "nebius") return v;
  return process.env.NEBIUS_PROJECT_ID && process.env.NEBIUS_SANDBOX_IMAGE ? "nebius" : "local";
}

export const PROJECT_ROOT = process.cwd();
export const EXAMPLES_DIR = path.join(PROJECT_ROOT, "examples");

export const LIMITS = {
  reproAttempts: 3,
  patchAttempts: 3,
  testTimeoutSec: 120,
  installTimeoutSec: 600,
  maxFileChars: 12000,
  maxContextFiles: 6,
  maxTreeEntries: 400,
  maxTarballBytes: 60 * 1024 * 1024,
};
