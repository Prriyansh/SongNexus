# .github/

GitHub configuration.

## Files at this level

- `CLAUDE.md` — this guide.

## Folders

- `workflows/ci.yml` — the CI job, on pushes to `main` and on pull requests: checkout, Node from
  `.nvmrc` with the npm cache, `npm ci`, then `lint`, `typecheck`, `test` and `build`.
  Keep it matching the scripts in `package.json`. No secrets are needed: the tests mock
  MusicBrainz and Deezer, and the build makes no network calls.
