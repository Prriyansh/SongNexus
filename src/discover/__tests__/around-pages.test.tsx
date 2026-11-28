// The Around You page, rendered whole.
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/discover/around" }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  type Props = { href: string; prefetch?: boolean; children?: unknown };
  return {
    default: ({ prefetch, ...props }: Props) => {
      void prefetch;
      return createElement("a", props as never);
    },
  };
});

import AroundPage from "@/app/discover/around/page";
import { query, renderPage, textOf } from "./render";

describe("Around You", () => {
  it("offers to look around a country, with or without a chart named in the address", async () => {
    for (const params of [{}, { c: "country:SE" }] as Record<string, string>[]) {
      const text = textOf(await renderPage(AroundPage(query(params))));
      expect(text).toContain("Look around a country");
      expect(text).toContain("Sweden");
    }
  });
});
