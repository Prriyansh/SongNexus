/**
 * The production Content-Security-Policy (the web service's headers in vercel.json) must not
 * break any screen. `vite preview` doesn't apply Vercel's headers, so the test adds the real
 * policy to document responses and fails on any violation.
 */
import {readFileSync} from 'node:fs';

import {expect, test} from '@playwright/test';

const vercel = JSON.parse(
  readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
) as {
  services: {
    web: {headers: {source: string; headers: {key: string; value: string}[]}[]};
  };
};
const csp = vercel.services.web.headers
  .find(h => h.source === '/(.*)')!
  .headers.find(h => h.key === 'Content-Security-Policy')!.value;

const ROUTES = [
  '/',
  '/explore',
  '/six-degrees',
  '/compare',
  '/play',
  '/library',
  '/you',
  '/about',
  '/privacy',
];

test('no screen violates the production CSP', async ({page}) => {
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (v: string) =>
    violations.push(v),
  );
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e =>
      (
        window as unknown as {reportViolation: (v: string) => void}
      ).reportViolation(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {...response.headers(), 'content-security-policy': csp},
    });
  });
  for (const path of ROUTES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await page.goto('/');
  await page
    .getByRole('combobox', {name: 'Search artists and songs'})
    .fill('drake');
  await expect(page.getByRole('option').first()).toBeVisible();
  expect(violations).toEqual([]);
});
