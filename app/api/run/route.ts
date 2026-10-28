import { runRepro } from "@/src/agent/pipeline";
import type { AgentEvent, IssueInput } from "@/src/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  let input: IssueInput;
  try {
    const body = (await request.json()) as IssueInput;
    input = {
      url: typeof body.url === "string" ? body.url : undefined,
      text: typeof body.text === "string" ? body.text.slice(0, 20000) : undefined,
      repoUrl: typeof body.repoUrl === "string" ? body.repoUrl : undefined,
      example: typeof body.example === "string" ? body.example : undefined,
    };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          return;
        }
      };
      await runRepro(input, send);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
