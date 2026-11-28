// What every page owes its readers: accessible, fits, quick, and well described.
import AxeBuilder from "@axe-core/playwright";
import { ABBA, expect, KENDRICK, NOBODY, SIX, TAYLOR, test, WEB } from "./page.mjs";

const PAGES = [
  ["home", "/discover"],
  ["six degrees", "/discover/six-degrees"],
  ["a path", SIX],
  ["a path around someone", `${SIX}&order=strongest&via=producers,bands`],
  ["collaborators", WEB],
  ["an artist", `/discover/artist/${ABBA}`],
  ["a song", "/discover/song/bfdcfb41-167c-4f5b-b163-bde83bbf69ac"],
  ["a label", "/discover/label/011d1192-6f65-45bd-85c4-0400dd45693e"],
  ["a genre", "/discover/genre/pop"],
  ["stories", "/discover/stories"],
  ["a story", "/discover/stories?story=2"],
  ["ask", "/discover/ask"],
  ["an answer", "/discover/ask?q=Who%20produced%20Umbrella%3F"],
  ["a question it can't answer", "/discover/ask?q=what%20is%20the%20meaning%20of%20life"],
  ["games", "/discover/games"],
  ["connect", "/discover/games/connect"],
  ["credit check", "/discover/games/credits"],
  ["the missing link", "/discover/games/link"],
  ["library", "/discover/library"],
  ["friend paths", "/discover/friends"],
  ["a friend's link", `/discover/friends?with=${TAYLOR},${KENDRICK}&name=Sam`],
  ["around you", "/discover/around"],
  ["a country", "/discover/around?c=country:SE"],
  ["you", "/discover/you"],
];
const RULES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

for (const [name, address] of PAGES) {
  test(`${name} is accessible, fits, and describes itself`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const response = await page.goto(address);
    expect(response.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("[role=status][aria-label=Loading]")).toHaveCount(0);

    const { violations } = await new AxeBuilder({ page }).withTags(RULES).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes[0].html}`)).toEqual([]);

    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(page.viewportSize().width);

    await expect(page).toHaveTitle(/^\S.* · Song Nexus$/);
    for (const meta of [
      "meta[name=description]",
      "meta[property='og:title']",
      "meta[property='og:description']",
    ]) {
      expect((await page.locator(meta).first().getAttribute("content")).length).toBeGreaterThan(10);
    }
    await expect(page.locator("link[rel=canonical]")).toHaveCount(1);
  });
}

test("controls are big enough to touch", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch only");
  for (const address of ["/discover", SIX, WEB]) {
    await page.goto(address);
    const small = await page.locator("main button:visible").evaluateAll((buttons) =>
      buttons
        .map((b) => [b.textContent || b.ariaLabel, b.getBoundingClientRect()])
        .filter(([, box]) => box.width < 24 || box.height < 24)
        .map(([name]) => name),
    );
    expect(small).toEqual([]);
  }
});

test("pages stay light", async ({ page }) => {
  // It visits every page, so it gets more than one page's time.
  test.setTimeout(PAGES.length * 10_000);
  for (const [name, address] of PAGES) {
    let script = 0;
    const count = async (response) => {
      if (/\.js(\?|$)/.test(response.url()))
        script += (await response.body().catch(() => "")).length;
    };
    page.on("response", count);
    await page.goto(address, { waitUntil: "networkidle" });
    page.off("response", count);
    const html = (await (await page.request.get(address)).body()).length;
    expect(html, `${name}: HTML`).toBeLessThan(420_000);
    expect(script, `${name}: scripts`).toBeLessThan(1_300_000);
  }
});

test("the catalog stays on the server", async ({ page }) => {
  const found = [];
  page.on("response", async (response) => {
    if (!/\.js(\?|$)/.test(response.url())) return;
    const text = await response.text().catch(() => "");
    if (text.includes("catalog.json") || text.includes(ABBA)) found.push(response.url());
  });
  for (const address of ["/discover", SIX, WEB])
    await page.goto(address, { waitUntil: "networkidle" });
  expect(found).toEqual([]);
});

test("unknown addresses say so, and aren’t indexed", async ({ page, allowed }) => {
  allowed.push(/404/);
  for (const kind of ["artist", "song", "label", "genre"]) {
    await page.goto(`/discover/${kind}/${NOBODY}`);
    await expect(page.getByRole("heading", { name: "That isn’t in this catalog" })).toBeVisible();
    await expect(page.locator("meta[name=robots]").first()).toHaveAttribute("content", /noindex/);
  }
});

test("shared links have a picture", async ({ page }) => {
  await page.goto("/discover");
  const image = await page.locator("meta[property='og:image']").first().getAttribute("content");
  const response = await page.request.get(new URL(image).pathname + new URL(image).search);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("pages are readable without scripts", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto(`/discover/artist/${ABBA}`);
  await expect(page.getByRole("heading", { level: 1, name: "ABBA" })).toBeVisible();
  await expect(page.getByRole("link", { name: "pop", exact: true })).toBeVisible();
  await context.close();
});

test("a photo that doesn’t load leaves initials, not a hole", async ({ page, allowed }) => {
  allowed.push(/Failed to load resource/);
  await page.route(/wikimedia\.org/, (route) => route.abort());
  await page.goto(`/discover/artist/${ABBA}`);
  await expect(page.locator(".dx-entity .dx-avatar")).toContainText("A");
  const box = await page.locator(".dx-entity .dx-avatar").boundingBox();
  expect(box.width).toBeGreaterThan(100);
});
