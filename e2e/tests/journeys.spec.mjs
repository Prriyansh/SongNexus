// Discover as someone uses it, from the sidebar to a shared link.
import { ABBA, expect, seen, SIX, test, WEB } from "./page.mjs";

const choose = async (page, name) => {
  const box = seen(page, "[role=combobox]").first();
  await box.fill(name);
  await seen(page, "[role=option]").first().waitFor();
  await box.press("Enter");
};
const node = (page, name) => page.locator(`.dx-node[aria-label="${name}"]`);
const openMenu = async (page, isMobile) => {
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
};

test.describe("finding things", () => {
  test("search marks matches and opens one with the keyboard", async ({ page }) => {
    await page.goto("/discover");
    const box = page.getByRole("combobox", { name: "Search Discover" });
    await box.fill("beyonce");
    await expect(page.getByRole("option").first()).toContainText("Beyoncé");
    await expect(page.locator("mark").first()).toHaveText("Beyoncé");
    await box.press("ArrowDown");
    await expect(page.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
    await box.press("ArrowUp");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/discover\/artist\//);
    await expect(page.getByRole("heading", { level: 1, name: "Beyoncé" })).toBeVisible();
  });

  test("/ jumps to search", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboards only");
    await page.goto("/discover");
    await page.keyboard.press("/");
    await expect(page.getByRole("combobox", { name: "Search Discover" })).toBeFocused();
    await expect(page.getByRole("combobox", { name: "Search Discover" })).toHaveValue("");
  });

  test("says when nothing matches, and when search is down", async ({ page, allowed }) => {
    allowed.push(/Failed to load resource/);
    await page.goto("/discover");
    const box = page.getByRole("combobox", { name: "Search Discover" });
    await box.fill("zzzzqqq");
    await expect(page.getByText("Nothing called “zzzzqqq” in this catalog.")).toBeVisible();
    await page.route("**/api/discover/search**", (route) => route.abort());
    await box.fill("abba");
    await expect(page.getByText("Search isn’t working right now")).toBeVisible();
    await page.unroute("**/api/discover/search**");
    await box.fill("abba ");
    await box.fill("abb");
    await expect(page.getByRole("option").first()).toContainText("ABBA");
  });

  test("leads from an artist through their songs, labels and genres and back", async ({ page }) => {
    await page.goto(`/discover/artist/${ABBA}`);
    await page.getByRole("link", { name: "pop", exact: true }).click();
    await expect(page).toHaveURL("/discover/genre/pop");
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "ABBA" })).toBeVisible();
    await seen(page, "main a[href*='/discover/song/']").first().click();
    await expect(page).toHaveURL(/\/discover\/song\//);
    await seen(page, ".dx-by a").first().click();
    await expect(page).toHaveURL(`/discover/artist/${ABBA}`);
  });

  test("tabs work with a keyboard", async ({ page }) => {
    await page.goto(`/discover/artist/${ABBA}`);
    const tabs = page.getByRole("tab");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(page.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      await tabs.nth(1).getAttribute("id"),
    );
  });
});

test.describe("Six Degrees", () => {
  test("from nothing to a path, swapped, and shared", async ({ page, context, isMobile }) => {
    if (!isMobile) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/discover/six-degrees");
    await choose(page, "adele");
    await expect(page).toHaveURL(/from=/);
    await expect(page.getByRole("button", { name: "Change Adele" })).toBeVisible();
    await choose(page, "daft punk");
    await expect(page.getByRole("heading", { name: /steps? apart/ })).toBeVisible();
    const chain = page.getByRole("list", { name: "Artists on this path" }).first();
    await expect(chain.getByRole("link").first()).toContainText("Adele");
    await page.getByRole("button", { name: "Swap the two artists" }).click();
    await expect(chain.getByRole("link").first()).toContainText("Daft Punk");
    if (!isMobile) {
      await page.getByRole("button", { name: "Share" }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    }
    const steps = await page.getByRole("heading", { name: /apart/ }).textContent();
    await page.reload();
    await expect(page.getByRole("heading", { name: steps })).toBeVisible();
  });

  test("goes around someone, and lets them back", async ({ page }) => {
    await page.goto(SIX);
    const around = page.getByRole("link", { name: /^Go around / }).first();
    const name = (await around.textContent()).replace("Go around ", "").trim();
    await around.click();
    await expect(page.getByRole("button", { name: `Allow ${name} again` })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Artists on this path" }).first(),
    ).not.toContainText(name);
    await page.getByRole("button", { name: `Allow ${name} again` }).click();
    await expect(page.getByRole("list", { name: "Artists on this path" }).first()).toContainText(
      name,
    );
  });

  test("changes what counts without closing the choices", async ({ page }) => {
    await page.goto(SIX);
    await page.getByText("Choose which connections count").click();
    await page.locator("label", { hasText: "Engineering" }).click();
    await expect(page).toHaveURL(/via=/);
    await expect(page.getByText("6 of 7 kinds of connection count")).toBeVisible();
    await expect(page.locator("label", { hasText: "Engineering" })).toBeVisible();
    await page.getByRole("radio", { name: "Closest connections" }).check({ force: true });
    await expect(page.getByRole("radio", { name: "Closest connections" })).toBeChecked();
    await expect(page).toHaveURL(/order=strongest/);
  });

  test("answers a choice at once, and keeps every one made in a hurry", async ({ page }) => {
    await page.goto(SIX);
    await page.getByText("Choose which connections count").click();
    await page.route(/_rsc=/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    for (const name of ["Engineering", "Samples", "Bands and projects"]) {
      const box = page.getByRole("checkbox", { name });
      const was = await box.isChecked();
      await box.click({ force: true });
      expect(await box.isChecked()).toBe(!was);
    }
    await expect(page).toHaveURL(/via=features%2Cproducers%2Ccontributions%2Cengineering/);
  });

  test("shows other ways in tabs, and surprises", async ({ page }) => {
    await page.goto(SIX);
    await page.getByRole("tab", { name: /^Another way · / }).click();
    await expect(
      page.getByRole("list", { name: "Artists on this path" }).getByRole("listitem"),
    ).toHaveCount(4);
    const before = page.url();
    await page.getByRole("button", { name: "Surprise me" }).click();
    await expect(page).not.toHaveURL(before);
    await expect(page.getByRole("heading", { name: /steps? apart/ })).toBeVisible();
  });
});

test.describe("Collaborators", () => {
  test("explains, opens, remembers and undoes", async ({ page }) => {
    await page.goto(WEB);
    const start = await page.locator(".dx-node").count();
    await node(page, "Dr. Dre").click();
    await expect(page.getByRole("heading", { name: "With Kendrick Lamar" })).toBeVisible();
    await expect(page.locator(".dx-side .dx-reasons")).toContainText("Dr. Dre");
    await page.getByRole("button", { name: "Open their connections" }).click();
    await expect.poll(() => page.locator(".dx-node").count()).toBeGreaterThan(start);
    await expect(page).toHaveURL(/open=/);
    const opened = await page.locator(".dx-node").count();
    await page.reload();
    await expect(page.locator(".dx-node")).toHaveCount(opened);
    await page.goto(WEB);
    await node(page, "Dr. Dre").click();
    await page.getByRole("button", { name: "Open their connections" }).click();
    await expect(page).toHaveURL(/open=/);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".dx-node")).toHaveCount(start);
    await expect(page).not.toHaveURL(/open=/);
  });

  test("moves by mouse: drag, wheel and double click", async ({ page, isMobile }) => {
    test.skip(isMobile, "mouse only");
    await page.goto(WEB);
    const svg = page.locator("svg[role=group]");
    const view = () => svg.getAttribute("viewBox");
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox();
    const first = await view();
    await page.mouse.move(box.x + 40, box.y + 60);
    await page.mouse.wheel(0, -300);
    await expect.poll(view).not.toBe(first);
    const zoomed = await view();
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 90, { steps: 4 });
    await page.mouse.up();
    expect(await view()).not.toBe(zoomed);
    await page.getByRole("button", { name: "Show everyone" }).click();
    await expect.poll(view).toBe(first);
    const before = await page.locator(".dx-node").count();
    await node(page, "Drake").dblclick();
    await expect.poll(() => page.locator(".dx-node").count()).toBeGreaterThan(before);
  });

  test("works with only a keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboards only");
    await page.goto(WEB);
    await node(page, "Kendrick Lamar").focus();
    await page.keyboard.press("ArrowRight");
    const chosen = page.locator(".dx-node[data-selected]");
    await expect(chosen).not.toHaveAttribute("aria-label", "Kendrick Lamar");
    await expect(chosen).toBeFocused();
    const before = await page.locator(".dx-node").count();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".dx-node").count()).toBeGreaterThanOrEqual(before);
    await expect(page).toHaveURL(/open=/);
  });

  test("starts over from someone else, and keeps going when a request fails", async ({
    page,
    allowed,
  }) => {
    allowed.push(/Failed to load resource/);
    await page.goto(WEB);
    await page.route("**/api/discover/neighborhood**", (route) => route.abort());
    await node(page, "Drake").click();
    await page.getByRole("button", { name: "Open their connections" }).click();
    await expect(page.getByText("The connections of Drake didn’t load. Try again.")).toBeVisible();
    await page.unroute("**/api/discover/neighborhood**");
    await page.getByRole("button", { name: "Open their connections" }).click();
    await expect(page).toHaveURL(/open=/);
    await choose(page, "abba");
    await expect(page).toHaveURL(`/discover/connections?artist=${ABBA}`);
    await expect(node(page, "ABBA")).toBeVisible();
  });
});

test.describe("the rest of Song Nexus", () => {
  test("leads here from its sidebar, and back", async ({ page, isMobile }) => {
    await page.goto("/about");
    await page
      .getByRole("button", { name: /^(Close|Skip)/ })
      .first()
      .click();
    for (const [name, address] of [
      ["Discover", "/discover"],
      ["Six Degrees", "/discover/six-degrees"],
      ["Collaborators", "/discover/connections"],
    ]) {
      await page.goto("/friends");
      await openMenu(page, isMobile);
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name })
        .click();
      await expect(page).toHaveURL(address);
      await expect(page.locator(".topbar-left strong")).toHaveText(name);
    }
    await openMenu(page, isMobile);
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Friends" })
      .click();
    await expect(page).toHaveURL("/friends");
    await expect(page.locator(".topbar-left strong")).toHaveText("Friends");
    await page.goBack();
    await expect(page).toHaveURL("/discover/connections");
  });

  test("opens the menu on a phone, and closes it with Escape", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phones only");
    await page.goto("/discover");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("button", { name: "Close navigation" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  });

  test("skips the navigation with the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboards only");
    await page.goto("/discover");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#discover-main")).toBeFocused();
  });
});
