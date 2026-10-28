import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { SANDBOXES_BASE_URL } from "../config";
import { clampOutput, type Runner, type RunRequest, type RunResult } from "./types";

interface StreamRepr {
  value: string;
  encoding: "ascii" | "base64";
}

interface OperationResponse {
  uuid: string;
  status: "PENDING" | "ASSIGNED" | "EXECUTING" | "SUCCESS" | "FAILED" | "CANCELLED";
  error?: string | null;
  result_image_uuid?: string | null;
  metadata?: {
    result?: {
      state?: { exit_code?: number; timed_out?: boolean };
      stdout?: StreamRepr;
      stderr?: StreamRepr;
    } | null;
  };
}

const TERMINAL = new Set(["SUCCESS", "FAILED", "CANCELLED"]);
const ARCHIVE_PATH = "/tmp/repropilot-workspace.tar";
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", ".pytest_cache"]);

function decode(stream?: StreamRepr): string {
  if (!stream?.value) return "";
  return stream.encoding === "base64" ? Buffer.from(stream.value, "base64").toString("utf8") : stream.value;
}

/**
 * Runs commands in Nebius Token Factory Sandboxes through the REST API.
 * Each run uploads the workspace as a tar file, spawns a disposable VM-isolated
 * instance from a prepared image, and polls the operation until it finishes.
 * Docs: https://docs.tokenfactory.nebius.com/sandboxes/reference/index.md
 */
export class NebiusSandboxRunner implements Runner {
  readonly name = "nebius-sandboxes";
  readonly description = "Runs tests in a VM-isolated Nebius Token Factory Sandbox.";
  readonly python = "python";
  readonly installsDependencies = true;
  private baseImage: string;

  constructor(
    private readonly apiKey = process.env.NEBIUS_API_KEY || "",
    private readonly projectId = process.env.NEBIUS_PROJECT_ID || "",
    image = process.env.NEBIUS_SANDBOX_IMAGE || "",
  ) {
    if (!apiKey || !projectId || !image) {
      throw new Error("Nebius Sandboxes runner needs NEBIUS_API_KEY, NEBIUS_PROJECT_ID and NEBIUS_SANDBOX_IMAGE.");
    }
    this.baseImage = image;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, Project: this.projectId, ...extra };
  }

  private async uploadWorkspace(workdir: string): Promise<string> {
    const archive = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "repropilot-tar-")), "ws.tar");
    await tar.c(
      { cwd: workdir, file: archive, portable: true, filter: (p) => !p.split("/").some((s) => SKIP_DIRS.has(s)) },
      ["."],
    );
    const body = await fs.readFile(archive);
    const res = await fetch(`${SANDBOXES_BASE_URL}/files`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/octet-stream" }),
      body,
    });
    if (!res.ok) throw new Error(`Sandboxes file upload failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { uuid: string };
    await fs.rm(path.dirname(archive), { recursive: true, force: true });
    return json.uuid;
  }

  private async spawn(req: RunRequest, disposable: boolean): Promise<OperationResponse> {
    const fileUuid = await this.uploadWorkspace(req.workdir);
    const command = `mkdir -p /work && tar -xf ${ARCHIVE_PATH} -C /work && cd /work && ${req.command}`;
    const res = await fetch(`${SANDBOXES_BASE_URL}/instances`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        command,
        shell: true,
        image: this.baseImage,
        disposable,
        env: req.env ?? {},
        timeout: req.timeoutSec,
        files: { [ARCHIVE_PATH]: { uuid: fileUuid, mode: "0644" } },
      }),
    });
    if (!res.ok) throw new Error(`Sandboxes spawn failed: ${res.status} ${await res.text()}`);
    const { uuid } = (await res.json()) as { uuid: string };
    return this.waitFor(uuid, req.timeoutSec + 120);
  }

  private async waitFor(operationId: string, budgetSec: number): Promise<OperationResponse> {
    const deadline = Date.now() + budgetSec * 1000;
    while (Date.now() < deadline) {
      const res = await fetch(`${SANDBOXES_BASE_URL}/operations/${operationId}`, { headers: this.headers() });
      if (!res.ok) throw new Error(`Sandboxes status failed: ${res.status} ${await res.text()}`);
      const op = (await res.json()) as OperationResponse;
      if (TERMINAL.has(op.status)) return op;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await fetch(`${SANDBOXES_BASE_URL}/operations/${operationId}`, { method: "DELETE", headers: this.headers() });
    throw new Error(`Sandboxes operation ${operationId} did not finish in ${budgetSec}s`);
  }

  private toResult(op: OperationResponse, started: number): RunResult {
    const result = op.metadata?.result;
    const output = [decode(result?.stdout), decode(result?.stderr), op.error ? `[sandbox] ${op.error}` : ""]
      .filter(Boolean)
      .join("\n");
    return {
      exitCode: result?.state?.exit_code ?? (op.status === "SUCCESS" ? 0 : 1),
      output: clampOutput(output),
      durationMs: Date.now() - started,
      timedOut: Boolean(result?.state?.timed_out),
    };
  }

  /** Installs dependencies once and keeps the resulting image as the base for later runs. */
  async prepare(workdir: string, installCommand: string, timeoutSec: number): Promise<RunResult> {
    const started = Date.now();
    const op = await this.spawn({ workdir, command: installCommand, timeoutSec }, false);
    if (op.status === "SUCCESS" && op.result_image_uuid) this.baseImage = op.result_image_uuid;
    return this.toResult(op, started);
  }

  async run(req: RunRequest): Promise<RunResult> {
    const started = Date.now();
    const op = await this.spawn(req, true);
    return this.toResult(op, started);
  }
}
