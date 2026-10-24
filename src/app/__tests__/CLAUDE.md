# src/app/__tests__/

Tests for the Next.js wiring. Run with `npm test` from the repository root.

## Files at this level

- `routes.test.ts` — checks the rewrites in `next.config.ts`: `/about`, `/about/manual` and
  `/compare/(artists|songs)` load the app page, `/prototype` serves the old HTML, and `/` is
  not rewritten.
- `CLAUDE.md` — this guide.

API route behaviour is covered through the functions they call, in `src/lib/__tests__/`.
