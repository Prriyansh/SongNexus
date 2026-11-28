// What every browser test starts from: no outside servers, and no errors left unnoticed.
import { test as base, expect } from "@playwright/test";

export { expect };

export const ABBA = "d87e52c5-bb8d-4da8-b941-9f4928627dc8";
export const TAYLOR = "20244d07-534f-4eff-b4d4-930878889970";
export const KENDRICK = "381086ea-f511-4aba-bdf9-71c753dc5077";
export const NOBODY = "00000000-0000-4000-8000-000000000000";
export const SIX = `/discover/six-degrees?from=${TAYLOR}&to=${KENDRICK}`;
export const WEB = `/discover/connections?artist=${KENDRICK}`;

/** Where pictures are hot-linked from. Nothing else outside may be asked. */
const PICTURES =
  /^https:\/\/((upload|thumb)\.wikimedia\.org|coverartarchive\.org|[a-z0-9.]*archive\.org)\//;
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Waits until React has taken over everything on the page, so nothing done to it is lost. */
async function ready(page) {
  await page.waitForFunction(() => {
    if (!location.pathname.startsWith("/discover")) return true;
    const parts = [...document.querySelectorAll("main, main .dx-panel, main .dx-web")];
    const taken = (e) => Object.keys(e).some((key) => key.startsWith("__reactProps"));
    return parts.length > 1 && parts.every(taken) && !document.querySelector(".dx-skeleton");
  });
}

export const test = base.extend({
  /** Errors a test expects: patterns added here are not failures. */
  allowed: async ({}, provide) => provide([]),
  page: async ({ page, baseURL, allowed }, provide) => {
    const errors = [];
    const outside = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    await page.route(
      (url) => !url.href.startsWith(baseURL),
      (route) => {
        const url = route.request().url();
        if (PICTURES.test(url)) return route.fulfill({ contentType: "image/gif", body: PIXEL });
        outside.push(url);
        return route.abort();
      },
    );
    for (const go of ["goto", "reload"]) {
      const original = page[go].bind(page);
      page[go] = async (...args) => {
        const response = await original(...args);
        await ready(page);
        return response;
      };
    }
    await provide(page);
    expect(errors.filter((e) => !allowed.some((pattern) => pattern.test(e)))).toEqual([]);
    expect(outside).toEqual([]);
  },
});

/** Next keeps the page you came from hidden behind this one, so look only at what can be seen. */
export const seen = (page, selector) => page.locator(selector).filter({ visible: true });
