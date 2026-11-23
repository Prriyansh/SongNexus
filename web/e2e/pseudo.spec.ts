/**
 * Pseudo-localization sweep: in the long-text (en-XA) and right-to-left (ar-XB)
 * pseudo-locales no screen scrolls sideways, has accessibility violations, or shows an
 * interface string that bypasses the message catalog.
 */
import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';

const ROUTES = [
  '/',
  '/explore',
  '/six-degrees',
  '/compare',
  '/play',
  '/library',
  '/you',
  '/friends',
  '/friends/join/ABCDE-FGHJK',
  '/compare/songs',
  '/about',
  '/privacy',
];

for (const locale of ['en-XA', 'ar-XB']) {
  test(`every screen holds up in ${locale}`, async ({page}) => {
    // Every route, each with an axe scan.
    test.setTimeout(120_000);
    for (const path of ROUTES) {
      await page.goto(`${path}?locale=${locale}`);
      await expect(page.getByRole('heading', {level: 1}).first()).toBeVisible();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);

      // Judge the settled page: entrance animations fade content in.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            // Skip endless ones (loading shimmer): they never finish.
            .filter(a => a.effect?.getComputedTiming().endTime !== Infinity)
            .map(a => a.finished.catch(() => undefined)),
        ),
      );
      const serious = (
        await new AxeBuilder({page})
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations.filter(
        v => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        serious.map(v => `${path} ${v.id}`),
        `${path} accessibility`,
      ).toEqual([]);

      if (locale === 'en-XA') {
        // Interface strings are pseudo-localized (wrapped in ⟦ ⟧); a plain one bypassed the catalog.
        // Long-form legal copy is deliberately English-only and marked lang="en" (translated later).
        const plain = await page
          .locator('main h1, main h2, main button, main label')
          .evaluateAll(els =>
            els
              .filter(
                e =>
                  (e as HTMLElement).offsetParent !== null &&
                  !e.closest('[lang="en"]'),
              )
              .map(e => (e.textContent ?? '').trim())
              .filter(text => text && !text.includes('⟦')),
          );
        expect(plain, `${path} has hard-coded strings`).toEqual([]);
      }
    }
  });
}
