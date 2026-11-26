// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import ClientApp from "../ClientApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../App", () => ({ default: () => <main>The app</main> }));

describe("ClientApp", () => {
  it("shows a loading placeholder, then the app once its code has loaded", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<ClientApp />));
    await vi.waitFor(() => expect(host.textContent).toBe("The app"));
    await act(async () => root.unmount());
  });
});
