# Trip Desk

Multi-trip planner. Two builds from one `src/`: an artifact build for
claude.ai and a hosted build for GitHub Pages. `README.md` covers the app,
`HOSTING.md` covers the one-time hosting setup.

## Live

- **Site:** https://invinceable17.github.io/trip-desk/ — GitHub Pages, served
  from `main` / `/docs`. There is no CI: `docs/` is committed build output, so
  **pushing to `main` deploys**. Rebuild before you push or you ship stale HTML.
- **Firebase project:** `trip-desk-ab201` (Firestore + Google sign-in).

## Commands

```
npm run build:web    # -> docs/   (hosted, Firestore-backed)
npm run build        # -> dist/   (artifact, artifact-file-backed)
npm test             # 121 unit checks, fast, no browser
npm run all          # both builds + every suite
```

`test:artifact` and `test:web` drive Playwright and need a browser installed.
They currently fail on this machine — `PLAYWRIGHT_BROWSERS_PATH` points at
`/opt/pw-browsers/...`, a Linux path — so they are unverified, not passing.
`npm test` is the one that actually runs.

## Traps

**A malformed `firebase.config.json` reports itself as missing.**
`build-web.mjs` parses it inside a `try`/`catch` whose `catch` only warns
`"firebase.config.json missing — building an unconfigured shell."` A syntax
error therefore takes the same path as an absent file: the build *succeeds*
and silently emits an app with no backend. The console hands you a JavaScript
object literal with unquoted keys, which is not JSON — quote them. Always
confirm the last build line reads `configured for Firebase project "..."`.

**`firestore.rules` in this repo is inert.** It does nothing until it is pasted
into Firestore → Rules → Publish in the console. Committing it is not
deploying it. It is also the *only* thing protecting the data.

**`firebase.config.json` is committed on purpose.** It identifies the project;
it does not authorise anything, and it is inlined into the public `docs/`
bundle regardless. GitHub's secret scanner flags the `AIza…` shape anyway —
that alert is expected. Rotating the key is pointless (the new one lands right
back in the public bundle); restricting it by HTTP referrer is the real
control.

**Adding a traveller** is a rules change only: they sign in once so their UID
exists, add it to `members()` in `firestore.rules`, publish. No redeploy.

**The service worker caches the app shell**, so a rebuild reaches people only
after two reloads — one to fetch the new shell, one to run it.
