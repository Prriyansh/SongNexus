# src/app/

Next.js App Router entry points.

## Files at this level

- `layout.tsx` — root HTML. Loads Inter and the frontend stylesheets in order
  (`styles.css` → `product.css` → `integration.css`; the order matters). Wraps children in
  `<div id="root">`, which `frontend/components/Modal.tsx` marks inert while a dialog is open.
- `page.tsx` — renders `frontend/ClientApp`, which loads the app with `ssr: false` (it reads
  `window.location` and `localStorage` on first render).
- `favicon.ico` — the site icon (Next serves it automatically).
- `CLAUDE.md` — this guide.

## Folders

- `api/` — JSON route handlers (see `api/CLAUDE.md`).
- `__tests__/` — tests for the Next wiring (see `__tests__/CLAUDE.md`). Folders starting with
  `_` are private in the App Router, so this never becomes a route.

Don't add more page routes for app screens; the client app owns navigation (history API) and
the rewrites make deep links work. If you add a URL, update `next.config.ts`,
`frontend/routing.ts` and `__tests__/routes.test.ts` together.
