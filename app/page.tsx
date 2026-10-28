import { getPublicConfig } from "@/src/agent/public-config";
import { ReproApp } from "./repro-app";

export const dynamic = "force-dynamic";

export default async function Page() {
  const config = await getPublicConfig();
  return <ReproApp config={config} />;
}
