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
npm test             # 152 unit checks, fast, no browser
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

## Writing the doc back out

`src/doc-emit.js` is the mirror of `doc-parse.js`: it renders the trip in the
planning doc's own format, and `views/Output.jsx` shows it in a drawer over the
right edge, opened by the **itinerary** button in the header.

**It is a drawer, not a page, and it has no backdrop.** The reason to open it is
to watch a change land while you make it, so the app underneath has to stay
live and the state lives in `App` — not in a phase view — or it would close
every time you changed phase. Above 1180px `body.doc-open` gives up the width
so the app slides over instead of hiding beneath it; use
`calc(var(--drawer) + 16px)` or you replace the body's own gutter and the app's
right edge sits flush against the drawer.

**Nothing keeps it in sync, and nothing needs to.** `blocks()` is a pure
function of the trip, rendered during App's render, and every edit goes through
`updateTrip` — so the keystroke and the line it rewrites land in the same
paint. There is no cache and nothing to invalidate. `check.mjs` types into a
day note with the drawer open and asserts the document changed. The format is
copied from the real doc — `DAY 1 - SAT OCTOBER 10`, asterisk bullets, hotels
indented three spaces beneath — including the abbreviations `TUES` and `THUR`,
which are hers and not the standard ones.

**A pin is on the block, never in the text.** Every emitted bullet that names
somewhere carries a `map`, and every line on a day's own list also carries a
`route` — the way to it from that day's hotel. `blocks()` builds them,
`Output.jsx` renders them, and `text()` deliberately drops both fields. The
clipboard is what pastes over the top of her document, and a map link is the
app's own working, not a line she wrote. It would also not survive the round
trip: `doc-parse` takes the first URL on a bullet as the item's link and leaves
the rest in the title, so a trailing `[map](…)` would come back as `Lunch near
Monti [map]()` with a maps URL where the ticket link belongs. A test asserts
`emitText` contains no `google.com/maps`.

**The day heading carries nothing.** It briefly carried the day's walk; the
route through a day assumed the order the items were typed in was a plan, and
it is not — it is the order somebody thought of them. A test asserts every
`kind: "day"` block has neither field.

**The pin says where the plane lands, not where the sentence says you are.**
"Arrive in Rome" is right for the document — you are going to Rome — but the
useful link on that line is FCO, which is where you are standing when you need
it.

**The document is longer than the trip.** `trip.dates` is when you are *there*;
the doc counts DAY 1 from when you *leave*, and an overnight flight departs the
day before. `docDays()` spans the earliest thing that happens to the latest and
fills every date in between. Emit `tripDays` instead and the outbound flight has
no day to sit on and silently vanishes.

**Ask where you sleep, not where you spend the day.** `cityForDay` answers the
second, and using it made the flight home read `Arrive in Naples at 2:39pm` —
you spent that morning in Naples, but the plane lands in Atlanta. `dayStay().sleep`
is empty on a departure day, which is exactly the signal to fall back to the
airport code and to print no city line at all.

**`blockDays` counts the bare-city days.** Every day inside a segment gets an
automatic `* Florence` line, so "days with no bullets" is always zero. An
unplanned day is one whose *only* content is that derived line.

**A stay has an `address`.** Added for this — the doc gives one for every hotel,
and a doc you cannot write back in full is half a loop. Additive, so old trips
still open; `doc-parse.js` reads `Address:` and `Booking confirmation No.:`
lines and hangs them on the hotel above them.

## One click to the place

`src/maps.js` builds every Google Maps link in the app: a pin on anything that
is somewhere, a route through anything that is several somewheres. It is its
own file and not part of `model.js` because it reads the trip back — which city
a day is spent in, which bed is actually booked — and `model.js` is what
answers that. The import goes one way only; `mapsSearch` and `hotelsIn` moved
here for that reason.

**A saved link beats a built one.** `isMapsUrl()` recognises a Google Maps link
already sitting in an item's or a stay's link field, and the pin then opens
that instead of searching. A `maps.app.goo.gl` link is the exact pin somebody
stood on and kept; a search for the title is only ever a guess at it.

**A name without a city is a coin flip.** "Duomo" matches a dozen churches, so
every query carries the city the day is in — `cityForDay`, which means a day
trip takes that day's items to Pompeii with it. `placeQuery()` drops a part
that repeats one already said, because a hotel address usually names its own
city and an item titled after the city it is in would otherwise search for
"Capri, Capri".

**Nine waypoints, and Maps drops the tenth in silence.** That is the limit of
the `/maps/dir/?api=1` scheme. A day longer than that would come back looking
routed while quietly missing stops, so `directions()` trims and reports
`dropped`.

**Every route is the hotel and one thing.** `itemRoute()` is the only route in
the app, and it has exactly two points: `dayBase()` — the stay for the segment
you *sleep* in that night — and the item. There is deliberately no route that
strings a day's stops together, no route through the trip's cities, and no
directions along a travel leg. A chained route assumes the order the items were
typed in is the order you will walk them, and it is not; what you want standing
in the lobby is how to reach the next thing.

**The base is where you sleep, not where you spend the day.** On a day trip to
Pompeii you still set out from the Rome hotel, so `dayBase()` reads
`dayStay().sleepSeg` and ignores the day-trip override. On the day you move to
Florence it is the Florence bed, because that is the one you are heading for.
It uses `leadStay()` — booked first, then the cheapest shortlisted — so it can
never name a different hotel than the cost breakdown and the ribbon do. No
stay for that segment means no route offered, not a route from the city centre.

**Walking only inside one city.** `itemRoute()` sets `travelmode=walking` when
the item's city matches the bed's, and names no mode otherwise: the trip out to
Pompeii is not a walk, and Maps picks one you can change in a tap.

**A leg gets a place, not directions.** `legPlaceUrl()` gives the end of a
travel leg with a station hint — "Naples" alone lands you in the middle of
Naples rather than at Centrale — and there is no `legRoute`. The leg *is* the
directions; the train is already booked.

## Two views of one trip

The five phases are for deciding; `src/views/Today.jsx` is for the morning you
wake up in Florence with one hand free. `#/t/<id>/today`, reached from the
**day of** button in the header.

**It is its own screen, not a denser desk.** `parseHash` returns
`view: "today"` and `App` returns `<Today>` before the wrap — no ribbon, no
stepper, no cost bar, no source bar, nothing editable. A check asserts the
screen carries no `input`, `textarea` or `select` at all: what you do not want
on a street corner is a form.

**The URL carries no date.** It resolves to the real current day every time it
is opened, which is what lets it sit on a phone's home screen and be right
every morning. Outside the trip it opens on day one and says how far off that
is. Days are `docDays`, so day numbers match the itinerary.

**It does not sort the day.** Half the lines have no time, and the plan
somebody wrote is a sequence — a view that reorders it is a view that
disagrees with the document. Times are shown; the order is the doc's.

**One layout, no media query.** The day-of CSS is sized for a thumb and simply
centres on a laptop; a one-day-at-a-time list wants a column either way.

## The place a line actually is

`item.place` is the override behind every pin. A tour is booked under a name
and met on a street corner: "Guru Walk Rome walking tour" is not a location and
no amount of guessing makes it one. Empty means "work it out from the title and
the day's city", which is right for a museum and useless for a pickup point.

**Taken verbatim, city and all.** `itemQuery()` does not append the day's city
to a place somebody typed — they already said which city, and appending
"Florence" to a Firenze address is the app second-guessing an instruction.

**A Maps URL in `place` is the exact pin** and opens as-is. It cannot be a
route *destination* though — the directions API wants a place and a short link
is opaque until Google resolves it — so `itemRoute()` falls back to the title
there. A test pins that.

**The editor is a pass, not a per-row control.** Days has one `Map places`
switch that opens a location line under every item, because adding these is
something you do down the trip in one go. The input's placeholder is the query
the app would use on its own: correcting a guess you cannot see is not
correcting anything.

**`blankItem` gains `place` safely** because day items are stored as written
and never spread over a fresh blank — unlike segments and stays, `hydrateTrip`
does not touch `days`. A test reads an item with no `place` key at all.

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

**Segment dates are derived, and there is nothing to edit.** `segmentSpans`
computes each stop's start from `trip.dates.start` plus the nights of every
stop before it — no start date is stored. To move when a city begins you change
the trip's start date or the nights of what precedes it. The ribbon and the
Cities list both read that one function, so they cannot disagree about a date;
if they *look* like they disagree, it is the wording.

**A night in the air is a stop, but not a city.** Every night of the trip
belongs to exactly one segment — that invariant is what makes the calendar
arithmetic work, and it is right. What was wrong is that segments were
*implicitly typed as cities*, so the only way to account for the night you
spend flying was to invent a place ("Overnight to Rome") and then infer
backwards that it was not one. Segments now carry `kind: "city" | "transit"`,
and `transitGap()` offers the night when a booked leg lands the day after it
departs, so nobody has to hand-craft a stub.

Typing it was not enough on its own: a transit stop that still rendered as a
row in the Cities list and a bar in the Cities lane is still being *filed* as a
city, whatever its label says. So `cityPlan()` returns `type: "transit"` and
the list draws a rule with a note on it — no swatch, no name field, no nights
control, nothing to reorder — while `SegmentLayer` returns `null` for it and
the lane simply has a gap. It keeps its nights either way, because the lane is
laid out cumulatively and skipping them would slide every city a day left.
Counts of "cities" filter it out; counts of *nights* must not, since that is
the check that every night is accounted for.

**A row with no lock must not be part of a lock check.** Removing the lock
control from the transit row while `citiesLocked` still required *every*
segment locked made the Cities phase permanently unfinished — a lock nobody
could ever close. `cityStops()` is the filter: counts and checks about
"cities" exclude nights under way, counts about *nights* must not, since that
is the check that every night is accounted for.

**Flights and the layout are two accounts of one trip.** `flightWindow()` is
the trip the flights describe; `datesDisagree()` returns where the two differ,
and Dates offers `adoptFlightDates()`. The chain is flights → dates → nights →
cities, and the last three already checked each other — this is the missing
first link, and the most load-bearing one, because the flights are the half
already paid for.

**An overnight leg is not an instant.** The Travel row draws points inside a
single day; a leg with `plusOne` is given `endIdx` and drawn midday-to-midday
so it visibly crosses the night it consumes. Width cannot distinguish the two
cases — mid-to-mid is also exactly one day wide — so `check.mjs` counts how
many day cells each chip overlaps.

**`blankSegment` must not default `kind`.** `hydrateTrip` spreads it over every
stored segment, so a default there is not a default — it is a rewrite of every
trip already saved, and it stamps `"city"` onto exactly the one-night stop
under an overnight flight that the type exists for. Absent means "infer", the
inference lives in `isTransitStop`, and anything the app creates
(`addSegment`, `blankTransit`) declares itself. A test asserts hydrate leaves
`kind` undefined; if it ever starts stamping one, that is the bug.

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

**An empty Firestore read is not evidence that the workspace is empty.**
Offline with a cold cache, `getDocs` returns an empty snapshot and *no error*.
`loadAll` used to treat that as a brand-new desk: it seeded the sample trip and
returned `migrated: true`, which makes `app.jsx` save immediately — writing the
seed order over a perfectly good `meta/index` from a phone that had simply not
reached the server yet. Worse, `idx.order.filter((id) => trips[id])` drops every
id when `trips` is empty, so even a healthy index computed to length zero.

`readVerdict()` in `store-common.js` now decides: data is trusted cached or not,
empty-from-cache is `"unknown"` (fall back to this browser's copy and write
nothing), an existing index means the desk was emptied on purpose, and only a
server-confirmed read with no index at all may seed. Never make seeding
reachable from a failed read — seeding writes.

Note the saver rewrites `meta/index` wholesale on every flush, so any device can
reorder the index from its own partial view. Trips themselves are only touched
when dirty, so nothing is lost by this; a trip missing from the index is still
loaded and appended.

**`firestore.rules` in this repo is inert.** It does nothing until it is pasted
into Firestore → Rules → Publish in the console. Committing it is not
deploying it. It is also the *only* thing protecting the data.

**`firebase.config.json` is committed on purpose.** It identifies the project;
it does not authorise anything, and it is inlined into the public `docs/`
bundle regardless. GitHub's secret scanner flags the `AIza…` shape anyway —
that alert is expected. Rotating the key is pointless (the new one lands right
back in the public bundle); restricting it by HTTP referrer is the real
control.

**Sign-in is popup-only, and the redirect flow must never come back.** The app
is served from `invinceable17.github.io` while Firebase's auth handler lives on
`trip-desk-ab201.firebaseapp.com`. The redirect flow matches its result to the
pending sign-in through storage on that second origin, and every modern mobile
browser partitions third-party storage — so the handler returns from Google
holding a valid authorisation code, finds nothing to match, and stops on a white
page. The documented fix is serving `/__/auth/handler` from the app's own
domain, which static GitHub Pages cannot do. `check-web.mjs` asserts
`signInWithRedirect` is absent from the bundle.

**Restricting the API key by referrer must include the auth domain.** The key is
restricted to `invinceable17.github.io/*`, which is the right control — but the
sign-in handler runs on `trip-desk-ab201.firebaseapp.com` and calls Identity
Toolkit with *that* as its referrer. Leave it off the allowed list and sign-in
dies with Google's generic "The requested action is invalid." The website
restrictions need both:

```
invinceable17.github.io/*
trip-desk-ab201.firebaseapp.com/*
```

To check the key's restrictions without the console, POST to
`identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=<key>` with a
`Referer` header and see whether it comes back blocked.

**Adding a traveller** is a rules change only: they sign in once so their UID
exists, add it to `members()` in `firestore.rules`, publish. No redeploy.

**The service worker caches the app shell.** Its install fetches with
`cache: "reload"` on purpose: GitHub Pages serves the shell with
`max-age=600`, and `addAll` goes through the HTTP cache like any other fetch,
so without it a *freshly named* cache could be filled from a ten-minute-old
copy — the worker updates, the cache key changes, and the app you get is
still the previous deploy. The navigation revalidation passes
`cache: "no-cache"` for the same reason. Take either off and a deploy stops
being visible without a hard refresh.
