import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../page";

describe("the app page", () => {
  it("sends only a loading placeholder from the server: the app needs the browser", () => {
    expect(renderToStaticMarkup(<Home />)).toBe('<div class="app-boot" role="status" aria-label="Loading Song Nexus"></div>');
  });
});
