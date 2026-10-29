export interface ModelInfo {
  id: string;
  label: string;
  role: string;
  source: string;
  verified: boolean;
}

const DEPRECATION_NOTICE = "https://docs.tokenfactory.nebius.com/model-deprecations-november-2026.md";

export const MODEL_CATALOG = {
  fast: {
    id: process.env.REPRO_MODEL_FAST || "nvidia/Nemotron-3_5-Lightning",
    label: "Nemotron 3.5 Lightning",
    role: "Issue triage, classification and summaries",
    source: DEPRECATION_NOTICE,
    verified: true,
  },
  reason: {
    id: process.env.REPRO_MODEL_REASON || "nvidia/Nemotron-3.5-Super-VL",
    label: "Nemotron 3.5 Super",
    role: "Writing the reproduction test and the patch",
    source: DEPRECATION_NOTICE,
    verified: true,
  },
  escalate: {
    id: process.env.REPRO_MODEL_ESCALATE || "nvidia/Nemotron-3-Ultra-550b-a55b",
    label: "Nemotron 3 Ultra",
    role: "Last patch attempt after the reasoning model fails twice",
    source: "https://custom.typingmind.com/tools/estimate-llm-usage-costs/nebius/nemotron-3-ultra-550b-a55b",
    verified: true,
  },
} satisfies Record<string, ModelInfo>;

export type ModelRole = keyof typeof MODEL_CATALOG;
