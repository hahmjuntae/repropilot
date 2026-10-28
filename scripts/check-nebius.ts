// 새 Token Factory 키 점검 대상: 모델 목록, Nemotron 1회 호출, Sandboxes 1회 실행
// 실행 기준: npm run check:nebius -- models chat images sandbox import-python 중 선택
import "./load-env";
import { SANDBOXES_BASE_URL, TOKEN_FACTORY_BASE_URL } from "../src/agent/config";
import { MODEL_CATALOG } from "../src/agent/models";

const key = process.env.NEBIUS_API_KEY || "";
const project = process.env.NEBIUS_PROJECT_ID || "";
const image = process.env.NEBIUS_SANDBOX_IMAGE || "";
const apiBase = TOKEN_FACTORY_BASE_URL.replace(/\/$/, "");

type Check = () => Promise<string>;

function need(name: string, value: string) {
  if (!value) throw new Error(`${name} is not set`);
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function sandboxHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${key}`, Project: project };
}

interface Operation {
  status: string;
  error?: string | null;
  result?: unknown;
  metadata?: { result?: { state?: { exit_code?: number }; stdout?: { value: string; encoding: string } } | null };
}

async function waitOperation(uuid: string, budgetSec: number): Promise<Operation> {
  const deadline = Date.now() + budgetSec * 1000;
  while (Date.now() < deadline) {
    const op = (await getJson(`${SANDBOXES_BASE_URL}/operations/${uuid}`, sandboxHeaders())) as Operation;
    if (["SUCCESS", "FAILED", "CANCELLED"].includes(op.status)) return op;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`operation ${uuid} did not finish in ${budgetSec}s`);
}

const models: Check = async () => {
  need("NEBIUS_API_KEY", key);
  const json = (await getJson(`${apiBase}/models`, { Authorization: `Bearer ${key}` })) as { data?: { id: string }[] };
  const ids = new Set((json.data ?? []).map((m) => m.id));
  const nemotron = [...ids].filter((id) => /nemotron/i.test(id)).sort();
  const lines = Object.entries(MODEL_CATALOG).map(([role, m]) => `  ${ids.has(m.id) ? "found  " : "MISSING"} ${role.padEnd(8)} ${m.id}`);
  const report = [`${ids.size} models in the catalog`, ...lines, `  Nemotron IDs: ${nemotron.join(", ") || "none"}`].join("\n");
  if (Object.values(MODEL_CATALOG).some((m) => !ids.has(m.id))) {
    throw new Error(`${report}\nSet REPRO_MODEL_FAST / REPRO_MODEL_REASON / REPRO_MODEL_ESCALATE to IDs from the list above.`);
  }
  return report;
};

const chat: Check = async () => {
  need("NEBIUS_API_KEY", key);
  const model = MODEL_CATALOG.fast.id;
  const started = Date.now();
  const json = (await postJson(`${apiBase}/chat/completions`, { Authorization: `Bearer ${key}` }, {
    model,
    messages: [{ role: "user", content: 'Reply with the JSON object {"ok": true} and nothing else.' }],
    max_tokens: 256,
    temperature: 0,
    response_format: { type: "json_object" },
  })) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
  const content = json.choices?.[0]?.message?.content ?? "";
  return `${model} answered in ${Date.now() - started} ms, ${json.usage?.total_tokens ?? "?"} tokens: ${content.trim().slice(0, 160)}`;
};

const images: Check = async () => {
  need("NEBIUS_API_KEY", key);
  need("NEBIUS_PROJECT_ID", project);
  await getJson(`${SANDBOXES_BASE_URL}/whoami`, sandboxHeaders());
  const json = (await getJson(`${SANDBOXES_BASE_URL}/images?tagged=1&limit=1000`, sandboxHeaders())) as {
    images?: { uuid: string; tag?: string | null }[];
  };
  const list = json.images ?? [];
  const python = list.filter((i) => /python/i.test(i.tag ?? ""));
  return [
    `Sandboxes access ok, ${list.length} tagged images. Images with python in the tag:`,
    ...(python.length ? python.map((i) => `  ${i.uuid}  tag:${i.tag}`) : ["  none. Run: npm run check:nebius -- import-python"]),
  ].join("\n");
};

const importPython: Check = async () => {
  need("NEBIUS_API_KEY", key);
  need("NEBIUS_PROJECT_ID", project);
  const { uuid } = (await postJson(`${SANDBOXES_BASE_URL}/images/import`, sandboxHeaders(), {
    registry: { url: "docker://docker.io/python:3.12-slim" },
    timeout: 900,
  })) as { uuid: string };
  const op = await waitOperation(uuid, 900);
  if (op.status !== "SUCCESS") throw new Error(`import ${op.status}: ${op.error ?? ""}`);
  return `Imported python:3.12-slim (operation ${uuid}). Set NEBIUS_SANDBOX_IMAGE to the image UUID below.\n${JSON.stringify(op.result ?? {}, null, 2)}`;
};

const sandbox: Check = async () => {
  need("NEBIUS_API_KEY", key);
  need("NEBIUS_PROJECT_ID", project);
  need("NEBIUS_SANDBOX_IMAGE", image);
  const started = Date.now();
  const { uuid } = (await postJson(`${SANDBOXES_BASE_URL}/instances`, sandboxHeaders(), {
    command: "python3 --version || python --version",
    shell: true,
    image,
    disposable: true,
    timeout: 60,
  })) as { uuid: string };
  const op = await waitOperation(uuid, 300);
  const result = op.metadata?.result;
  const out = result?.stdout;
  const stdout = out ? (out.encoding === "base64" ? Buffer.from(out.value, "base64").toString("utf8") : out.value) : "";
  if (op.status !== "SUCCESS" || result?.state?.exit_code !== 0) {
    throw new Error(`operation ${uuid} ${op.status}, exit ${result?.state?.exit_code}: ${op.error ?? stdout}`);
  }
  return `operation ${uuid} finished in ${Date.now() - started} ms: ${stdout.trim()}`;
};

const CHECKS: Record<string, Check> = { models, chat, images, sandbox, "import-python": importPython };
const DEFAULT = ["models", "chat", "images", "sandbox"];

async function main() {
  const picked = process.argv.slice(2).filter((a) => a in CHECKS);
  let failed = 0;
  for (const name of picked.length ? picked : DEFAULT) {
    try {
      console.log(`PASS ${name}\n${await CHECKS[name]()}\n`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${name}\n${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
