import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { EXAMPLES_DIR, TOKEN_FACTORY_BASE_URL, isMockLLM } from "./config";
import { MODEL_CATALOG, type ModelRole } from "./models";
import type { LLMCallRecord } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface JsonCall {
  purpose: "triage" | "repro" | "patch";
  role: ModelRole;
  messages: ChatMessage[];
  attempt: number;
  exampleId?: string;
  maxTokens?: number;
}

export interface JsonResult<T> {
  data: T;
  record: LLMCallRecord;
}

export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`Model did not return JSON: ${cleaned.slice(0, 200)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.NEBIUS_API_KEY) {
    throw new Error("NEBIUS_API_KEY is not set. Set it, or run with MOCK_LLM=1 to replay the bundled example.");
  }
  client ??= new OpenAI({ apiKey: process.env.NEBIUS_API_KEY, baseURL: TOKEN_FACTORY_BASE_URL });
  return client;
}

type Script = Record<JsonCall["purpose"], unknown[]>;
const scripts = new Map<string, Script>();

async function scripted(call: JsonCall): Promise<unknown> {
  if (!call.exampleId) {
    throw new Error("MOCK_LLM=1 only replays bundled examples. Pick the example issue or set NEBIUS_API_KEY.");
  }
  let script = scripts.get(call.exampleId);
  if (!script) {
    const file = path.join(EXAMPLES_DIR, call.exampleId, "scripted-responses.json");
    script = JSON.parse(await fs.readFile(file, "utf8")) as Script;
    scripts.set(call.exampleId, script);
  }
  const answers = script[call.purpose] ?? [];
  const answer = answers[Math.min(call.attempt - 1, answers.length - 1)];
  if (answer === undefined) throw new Error(`No scripted ${call.purpose} response for ${call.exampleId}`);
  await new Promise((r) => setTimeout(r, 400));
  return answer;
}

/** Calls a Nemotron model on Nebius Token Factory and parses a JSON object from the reply. */
export async function callJson<T>(call: JsonCall): Promise<JsonResult<T>> {
  const model = MODEL_CATALOG[call.role].id;
  const started = Date.now();
  if (isMockLLM()) {
    const data = (await scripted(call)) as T;
    return { data, record: { purpose: call.purpose, model, mock: true, durationMs: Date.now() - started } };
  }
  const completion = await getClient().chat.completions.create({
    model,
    messages: call.messages,
    temperature: 0.2,
    max_tokens: call.maxTokens ?? 4096,
    response_format: { type: "json_object" },
  });
  const text = completion.choices[0]?.message?.content ?? "";
  return {
    data: extractJson(text) as T,
    record: {
      purpose: call.purpose,
      model,
      mock: false,
      durationMs: Date.now() - started,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
    },
  };
}
