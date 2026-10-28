import type { SearchHit } from "./types";

/** Looks up known reports of the error with Tavily. Returns null when no key is configured. */
export async function searchKnownIssues(query: string): Promise<SearchHit[] | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key || !query.trim()) return null;
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 5, search_depth: "basic" }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
  const json = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  return (json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 300) }));
}
