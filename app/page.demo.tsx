import fs from "node:fs/promises";
import path from "node:path";
import type { PublicConfig } from "@/src/agent/public-config";
import { ReproApp } from "./repro-app";

export default async function DemoPage() {
  const file = path.join(process.cwd(), "public", "replay", "config.json");
  const config = JSON.parse(await fs.readFile(file, "utf8")) as PublicConfig;
  return <ReproApp config={config} />;
}
