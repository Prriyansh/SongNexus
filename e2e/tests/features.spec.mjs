// Discover's newer features, used as people use them: Stories, Ask, For you, the games, Library,
// Friend paths, You and Around You, plus what a deployment shows of itself.
import { ABBA, expect, KENDRICK, seen, TAYLOR, test } from "./page.mjs";

/** Saves About Me favourites in this browser, as the app does. */
async function favour(page, ...artists) {
  await page.evaluate(
    (ids) =>
      localStorage.setItem(
        "song-nexus-profile",
        JSON.stringify({ artists: ids.map((id) => ({ id, name: "x" })), songs: [], albums: [], genres: [] }),
      ),
    artists,
  );
}

/** Types into a search box and takes its first result with Enter. */
async function pick(page, box, text) {
  await box.fill(text);
  await expect(seen(page, "[role=option]").first()).toBeVisible();
  await box.press("Enter");
}

test.describe("Stories", () => {
  test("move on and back with the buttons, the keys and the address", async ({ page, isMobile }) => {
    await page.goto("/discover/stories");
    await expect(seen(page, ".dx-story-count")).toHaveText(/^Story 1 of \d+$/);
    await expect(seen(page, ".dx-story .dx-reasons li").first()).toBeVisible();
    await seen(page, "a.dx-button").filter({ hasText: "Next" }).click();
    await expect(page).toHaveURL(/story=2$/);
    await expect(seen(page, ".dx-story-count")).toHaveText(/^Story 2 of/);
    test.skip(isMobile, "keys are for keyboards");
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/story=1$/);
  });

  test("today's story on the home page opens it", async ({ page }) => {
    await page.goto("/discover");
    const today = seen(page, "a.dx-today");
    await expect(today).toContainText("Today’s story");
    await today.click();
    await expect(page).toHaveURL(/\/discover\/stories\?story=\d+$/);
  });
});

test.describe("Ask", () => {
  test("answers a question in plain words from the credits", async ({ page }) => {
    await page.goto("/discover/ask");
    await page.getByLabel("Ask about the credits").fill("Who produced Umbrella?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page).toHaveURL(/q=Who/);
    await expect(seen(page, "h2.dx-answer")).toHaveText("Who produced “Umbrella”");
    await expect(seen(page, ".dx-reply")).toContainText("Producers");
  });

  test("takes a question typed into search", async ({ page }) => {
    await page.goto("/discover");
    const box = page.getByRole("combobox", { name: "Search Discover" });
    await box.fill("who produced umbrella");
    await expect(page.getByRole("link", { name: "Ask it as a question" })).toBeVisible();
    await box.press("Enter");
    await expect(page).toHaveURL(/\/discover\/ask\?q=who/);
    await expect(seen(page, "h2.dx-answer")).toHaveText("Who produced “Umbrella”");
  });

  test("says when it can't answer, and offers questions it can", async ({ page }) => {
    await page.goto("/discover/ask?q=what%20is%20the%20meaning%20of%20life");
    await expect(seen(page, "h2.dx-answer")).toHaveText("Not a question Ask can answer yet");
    await page.getByRole("link", { name: "Who produced Umbrella?" }).click();
    await expect(seen(page, "h2.dx-answer")).toHaveText("Who produced “Umbrella”");
  });
});

test.describe("For you", () => {
  test("points to About Me, then suggests from favourites, and hides one", async ({ page }) => {
    await page.goto("/discover");
    await expect(page.getByText("Add the artists, songs and genres you love in")).toBeVisible();
    await favour(page, TAYLOR);
    await page.reload();
    const first = seen(page, ".dx-pick").first();
    await expect(first).toContainText("Because you like Taylor Swift");
    const name = await first.locator("strong").textContent();
    await first.getByRole("button", { name: `Don’t suggest ${name}` }).click();
    await expect(seen(page, ".dx-pick strong").first()).not.toHaveText(name);
  });

  test("keeps the artists opened lately", async ({ page }) => {
    await page.goto(`/discover/artist/${ABBA}`);
    await page.goto("/discover");
    await expect(seen(page, "section[aria-label='Where you left off']")).toContainText("ABBA");
  });
});

test.describe("Games", () => {
  test("Connect says when two artists didn't work together, then shows the answer", async ({ page }) => {
    await page.goto("/discover/games/connect");
    // The name, not the initials behind the photo.
    const start = (await seen(page, ".dx-connect-face > span:last-child").first().textContent()).trim();
    await pick(page, page.getByRole("combobox", { name: `Who did ${start} work with?` }), start);
    await expect(page.getByText(`No credit links ${start} and`)).toBeVisible();
    await page.getByRole("button", { name: "Show me the answer" }).click();
    await expect(page.getByText(/^You stopped here/)).toBeVisible();
    await page.getByRole("link", { name: "See the shortest paths" }).click();
    await expect(page).toHaveURL(/\/discover\/six-degrees\?from=/);
  });

  for (const [game, total] of [["credits", 5], ["link", 3]]) {
    test(`${game === "credits" ? "Credit check" : "The missing link"} to the end, and onto the leaderboard`, async ({ page }) => {
      await page.goto(`/discover/games/${game}`);
      for (let i = 1; i <= total; i++) {
        await expect(page.getByText(`Question ${i} of ${total}`)).toBeVisible();
        await seen(page, "button.dx-option").first().click();
        await expect(seen(page, ".dx-quiz-proof .dx-reasons li").first()).toBeVisible();
        await page.getByRole("button", { name: i < total ? "Next question" : "See my score" }).click();
      }
      await expect(page.getByText(new RegExp(`^You got \\d of ${total} right\\.$`))).toBeVisible();
      await page.getByLabel("Your name on the board").fill("Browser Test");
      await page.getByRole("button", { name: "Add my score" }).click();
      await expect(seen(page, ".dx-board-list")).toContainText("Browser Test");
      await expect(page.getByText(/^You’re \d+ of \d+\.$/)).toBeVisible();
      await page.goto("/discover/games");
      await expect(seen(page, ".dx-game").filter({ hasText: game === "credits" ? "Credit check" : "The missing link" })).toContainText(
        "Done ·",
      );
      await expect(seen(page, ".dx-tally")).toContainText("1 day in a row");
    });
  }
});

test.describe("Library and Friend paths", () => {
  test("Library checks a username before connecting it", async ({ page }) => {
    await page.goto("/discover/library");
    await page.getByLabel("Service", { exact: true }).selectOption("deezer");
    await page.getByLabel("Connect a service by its public username").fill("not-a-number");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText("That isn’t a Deezer username.")).toBeVisible();
  });

  test("Your Nexus shows how favourites hang together", async ({ page }) => {
    await page.goto("/discover/library");
    await favour(page, TAYLOR, KENDRICK);
    await page.reload();
    await expect(page.getByRole("heading", { name: "The people between them" })).toBeVisible();
  });

  test("a friend's link shows the paths between your artists and theirs, and yours can be copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/discover/friends");
    await expect(page.getByText("First tell Song Nexus what you like")).toBeVisible();
    await favour(page, TAYLOR);
    await page.goto(`/discover/friends?with=${KENDRICK},${ABBA}&name=Sam`);
    await expect(page.getByRole("heading", { name: "Sam’s artists" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "From your artists to Sam’s" })).toBeVisible();
    await expect(seen(page, ".dx-steps > li").first()).toContainText(/\d steps?/);
    await page.getByPlaceholder("Your name (optional)").fill("Alex");
    await page.getByRole("button", { name: "Copy your link" }).click();
    await expect(page.getByText("Copied")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(new RegExp(`/discover/friends\\?with=${TAYLOR}&name=Alex$`));
  });
});

test.describe("You and Around You", () => {
  test("You keeps a Top 5 and the data in this browser, and says sign-in isn't set up", async ({ page }) => {
    await page.goto("/discover/you");
    await expect(page.getByText("Sign-in isn’t set up on this server")).toBeVisible();
    await pick(page, page.getByRole("combobox", { name: "Add an artist" }), "abba");
    await expect(seen(page, ".dx-top")).toContainText("ABBA");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download it" }).click();
    expect((await download).suggestedFilename()).toBe("song-nexus.json");
    await page.getByRole("button", { name: "Delete it from this browser" }).click();
    await page.getByRole("button", { name: "Yes, delete everything in this browser" }).click();
    await expect(seen(page, ".dx-top")).toHaveCount(0);
  });

  test("Around You looks around a country, whose chart waits for members", async ({ page }) => {
    await page.goto("/discover/around");
    await expect(page.getByText("to join your campus or a country")).toBeVisible();
    await page.getByLabel("Look around a country").selectOption("SE");
    await page.getByRole("button", { name: "Look", exact: true }).click();
    await expect(page).toHaveURL(/c=country%3ASE/);
    await expect(seen(page, "section[aria-label=Sweden]")).toContainText("The chart opens when 5 more members share");
  });
});

test.describe("the deployment", () => {
  test("reports what it has switched on, without secrets", async ({ page }) => {
    const health = await (await page.request.get("/api/health")).json();
    expect(health).toMatchObject({ storage: "memory", features: { leaderboards: true, accounts: false, aiSearch: false } });
    expect(health.catalog.artists).toBeGreaterThan(1000);
    expect(health.problems).toContain("Memory storage in production: each server instance has its own, and all of it goes on a restart.");
  });

  test("sends its security headers", async ({ page }) => {
    const headers = (await page.goto("/discover")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  });

  test("keeps personal pages out of search engines", async ({ page }) => {
    for (const address of ["/discover/you", "/discover/library", "/discover/friends"]) {
      await page.goto(address);
      await expect(page.locator("meta[name=robots]").first()).toHaveAttribute("content", /noindex/);
    }
  });

  test("the sidebar leads to every Discover page", async ({ page, isMobile }) => {
    test.skip(isMobile, "the phone's sidebar is behind a menu");
    await page.goto("/discover");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const label of ["Stories", "Ask", "Games", "Library", "Friend paths", "Around You", "You"])
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  });
});
