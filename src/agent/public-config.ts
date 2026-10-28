import { isMockLLM, runnerKind } from "./config";
import { listExamples } from "./issue";
import { MODEL_CATALOG } from "./models";

export interface PublicConfig {
  mockLLM: boolean;
  runner: string;
  tavily: boolean;
  models: { role: string; id: string; label: string; purpose: string }[];
  examples: { id: string; title: string }[];
}

export async function getPublicConfig(): Promise<PublicConfig> {
  return {
    mockLLM: isMockLLM(),
    runner: runnerKind(),
    tavily: Boolean(process.env.TAVILY_API_KEY),
    models: Object.entries(MODEL_CATALOG).map(([role, m]) => ({ role, id: m.id, label: m.label, purpose: m.role })),
    examples: await listExamples(),
  };
}
