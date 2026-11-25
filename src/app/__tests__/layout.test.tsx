import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("next/font/google", () => ({ Inter: () => ({ className: "inter" }) }));
vi.mock("@/frontend/styles.css", () => ({}));
vi.mock("@/frontend/product.css", () => ({}));
vi.mock("@/frontend/integration.css", () => ({}));

describe("root layout", () => {
  // Extensions inject attributes such as style="isolation: isolate" into <body> before React
  // hydrates; that must not log a hydration error on every page load.
  it("ignores attributes added to <body> before hydration", async () => {
    const { default: RootLayout } = await import("../layout");
    const html = RootLayout({ children: null } as never) as ReactElement<{ children: ReactElement<{ suppressHydrationWarning?: boolean; className?: string }> | ReactElement[] }>;
    const children = Array.isArray(html.props.children) ? html.props.children : [html.props.children];
    const body = children.find((child) => (child as ReactElement)?.type === "body") as ReactElement<{ suppressHydrationWarning?: boolean; className?: string }>;
    expect(body.props.suppressHydrationWarning).toBe(true);
    expect(body.props.className).toBe("inter");
  });
});
