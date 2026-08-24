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
npm test             # 147 unit checks, fast, no browser
npm run all          # both builds + every suite
```

`test:artifact` and `test:web` drive Playwright. Run `npx playwright install
chromium` once and `npm run all` passes end to end. Set `PW_CHROME` to an
executable path if the browser lives outside Playwright's own cache.

`check-web.mjs` asserts the sign-in gate in *both* states, reading
`firebase.config.json` the same way the build does. It previously assumed the
build was unconfigured, and went stale the day the project got a config — a
failure nobody saw, because a hardcoded Linux browser path meant the suite had
never run here at all.

## The doc behind a trip

A trip can be a structured view of a Google Doc somebody else actually writes
in. `src/doc-parse.js` reads a planning doc into a patch; `src/doc-sync.js`
folds that patch onto a trip and remembers what the doc said, field by field,
in `trip.source.fields`. `src/views/Source.jsx` is the bar under the header and
the panel it opens.

**Google will not let the doc be edited inside the page.** `docs.google.com`
serves `X-Frame-Options: SAMEORIGIN` on every route, so the editor cannot be
framed. `/preview` and published `/pub` are framable but read-only. The app
links out; it does not embed.

**The page cannot fetch the doc either.** Google's export and publish endpoints
send no `Access-Control-Allow-Origin`, so there is no client-side-only sync. The
routes that do work are an Apps Script bound to the doc pushing into Firestore
with a service account, or pasting the text in. Today it is paste.

**Import never silently overwrites.** Every tracked field records the doc's
value alongside the trip's, so the two can disagree out loud — that is what the
"n differ" badge counts, and what `driftList()` returns. A line the parser does
not recognise goes into `unparsed` and is shown, never guessed at.

**A hotel renamed in the doc reads as a different hotel.** The doc has no ids,
so a rename and a replacement are the same edit. Both survive; you delete the
stale one. This is deliberate — see the comment above `key()` in `doc-sync.js`.

## Phone

Below 768px `page.html` restyles the app: system font for prose, mono kept for
codes and money, 44px targets, 16px inputs (anything smaller makes iOS zoom on
focus and never zoom back), and the phase stepper fixed to the bottom as a tab
bar. Above that breakpoint nothing changed — the Gantt desk is untouched. The
`:has()` rule that stands the wordmark down when a trip is open has an
`@supports not` fallback.

`npm run shots` also had the hardcoded Linux browser path, so it had never run
here either; it now reads `PW_CHROME` like the other two. The phone shots are
`shot-phone-*.png`.

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
