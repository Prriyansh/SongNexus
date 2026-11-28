// The Ask page with AI search on: it says so, and marks an answer to a question read by AI.
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ai: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/discover/ask" }));
// Outside a request, connection() refuses; here it only marks the page as dynamic.
vi.mock("next/server", async (actual) => ({ ...(await actual<object>()), connection: async () => {} }));
// The visitor asking, as Vercel forwards it.
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) }));
vi.mock("@/discover/lib/ai-ask", async (actual) => {
  const real = await actual<typeof import("@/discover/lib/ai-ask")>();
  const { ask } = await import("@/discover/lib/ask");
  return {
    ...real,
    aiEnabled: () => true,
    askWithAi: async (g: Parameters<typeof ask>[0], raw: string) => ({ answer: ask(g, raw), ai: state.ai }),
  };
});

import AskPage from "@/app/discover/ask/page";
import { query, renderPage, textOf } from "./render";

describe("Ask with AI search on", () => {
  it("says hard questions are read by AI, and marks an answer read that way", async () => {
    const text = textOf(await renderPage(AskPage(query({ q: "Who produced Umbrella?" }))));
    expect(text).toContain("are read by AI");
    expect(text).toContain("Read by AI as the question below.");
    expect(text).toContain("Who produced “Umbrella”");
  });

  it("leaves answers the patterns read unmarked", async () => {
    state.ai = false;
    expect(textOf(await renderPage(AskPage(query({ q: "Who produced Umbrella?" }))))).not.toContain("Read by AI as");
  });
});
