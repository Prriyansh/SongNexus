# Test readiness — November 13, 2026

The music account implementation is ready for local acceptance testing at `/accounts`.

| Check | Result |
| --- | --- |
| JavaScript/TypeScript automated suite | 525 tests passed across 43 files |
| ESLint | Passed |
| Next.js route generation and TypeScript | Passed |
| Next.js production build | Passed, including `/privacy` and all account APIs |
| Local HTTP smoke against a running Next.js server | Passed; temporary account and data deleted |
| Live music provider authorization and synchronization | Not tested; needs actual user credentials and developer setup |
| Docker image/Compose and external Postgres deployment | Not executed; Docker is unavailable in this environment |
| Separate, unchanged Python comparison service | Test attempt could not run: installed Python has no `pytest` |

The environment has a standalone Node binary but no `npm` command on PATH, so JavaScript checks were executed through the installed tools' Node entry points, equivalent to the documented package scripts. Install a complete Node 22 distribution with npm for normal local commands. The test worker count is capped at four to avoid resource starvation in the WASM database and jsdom suites.

Implemented: independent multi-user accounts, encrypted provider credentials, seven provider adapters, persistent SQL migrations and job queue, scheduling and recovery, per-resource sync state, SSE dashboard updates, provider capability/policy reporting, a private library with source filters and playlist/history pages, previewed/batched imports, explicit source-combination consent, open-source discovery handoff, disconnect/import/account deletion, privacy information, setup documentation, environment template and Docker/cron configuration.

Access-blocked or unsupported: Amazon Music needs approved partner access; Deezer account connections remain disabled without approved access; native Shazam library access requires a native Apple client and is not available in this web repository. Shazam CSV import is implemented. Missing developer credentials hide Connect actions for the other affected services. Google OAuth is presented as YouTube access with explicit YouTube Music limitations. Native playback/scrobble submission is not available because the existing app has no eligible first-party playback event source.

No integration is represented as live-tested or provider-approved. Actual provider authorization, subscription/tier limitations, quotas, production TLS/Postgres/secrets, Docker execution and manual real-browser acceptance remain to be tested/configured by the deployment owner. See [setup and smoke tests](README.md), [provider setup](providers.md), and [compliance](compliance.md).
