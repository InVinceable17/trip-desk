# Trip Desk

Multi-trip planner. Five phases per trip — dates, flights, cities, stays,
days — with live Google Flights search and fare-brand price checks.

Two builds from one codebase:

| Target | Storage | Live fare checks | Where |
|---|---|---|---|
| **Artifact** (`npm run build`) | the artifact's own files | yes, via the Browserless connector | claude.ai, signed into your account |
| **Hosted** (`npm run build:web`) | Firestore | no — deep links only | any browser, installable, offline |

The hosted build is the everyday one; see **[HOSTING.md](HOSTING.md)** to set it
up. The artifact build is where fare scraping still works, because that connector
only exists inside Claude.

## Build

```
npm install
npm run icons       # once — renders assets/ from the app's own mark
npm run all         # both targets + every test
```

Individually: `npm run build` → `dist/artifact.html`, `npm run build:web` →
`docs/` (what GitHub Pages serves), `npm test` → 121 offline checks,
`npm run test:artifact` / `npm run test:web` → headless end-to-end runs.

`build.mjs` bundles React 18 and the app into a single inline `<script>` with
esbuild and injects it into `src/page.html`. Artifacts block CDNs, so nothing
may be fetched at runtime — which also sidesteps the `@babel/standalone`
automatic-JSX-runtime trap noted in the root `CLAUDE.md`.

Publish `dist/artifact.html` with the Artifact tool, declaring:

```js
{ artifact: {}, mcp: { servers: [{ server: "Browserless", tools: ["browserless_function"] }] } }
```

## Layout

| File | What's in it |
|---|---|
| `src/flights.js` | Date/duration helpers, the Google Flights `tfs` protobuf URL builder, flight shapes. Pure. |
| `src/model.js` | What a trip is: segment↔day maths, cost roll-up, phase completion, v1 migration. Pure. |
| `src/parsers.js` | Regex readers for the fare ladder, search rows, flight numbers, pasted itineraries. Pure. |
| `src/scrape.js` | The Browserless layer: three one-page-load stages and the price-check pipeline. |
| `src/store.js` | One import point: the common half plus whichever backend this build targets. |
| `src/store-common.js` | Snapshots, the unsaved-draft stash, the portable backup bundle — identical either way. |
| `src/store-artifact.js` | Backend: `data/index.json` + `data/trips/<id>.json` inside the artifact. |
| `src/store-firebase.js` | Backend: Firestore, Google sign-in, offline cache, cross-device listener. |
| `src/backend.js` | The swap point. `build-web.mjs` resolves it to the Firestore adapter. |
| `src/app.jsx` | Shell — hash router, header, the two-column desk, tabs, the open-questions shelf. |
| `src/views/Itinerary.jsx` | The left column: the whole trip as one editable document. |
| `src/views/*.jsx` | One per workbench panel, plus `Trips.jsx` for the landing browser. |
| `src/components/Timeline.jsx` | The rail primitive: a day header plus a stack of layer rows. |
| `src/components/TripTimeline.jsx` | Decides which layers a trip has, and which one is live. |
| `src/page.html` | Body markup, the token palette, and the `/*__BUNDLE__*/` marker. |
| `test.mjs` | Offline unit checks, including against page text captured live from Google Flights. |
| `check.mjs` | Headless end-to-end run against a mocked artifact runtime. |
| `check-web.mjs` | Smoke test for the hosted build: it boots, gates, and the PWA files are sound. |
| `build-web.mjs` / `make-icons.mjs` | The hosted target and its icons. |
| `firestore.rules` | Who may read and write. The config in the page is public; **this** is the lock. |
| `shots.mjs` | Screenshots of every view, both themes, plus a narrow width. |

## The desk

Two columns, a third and two thirds. **Left** is the itinerary: every day of the
trip, top to bottom, always on screen. It is never navigated away from, so there
is always an answer to "what is this trip" without clicking anything. **Right**
is the workbench — Dates, Transport, Cities, Stays — plus the ribbon above it.
Under 900px the two stack, document first; under 768px the tabs become the
bottom bar. The tabs are `position: sticky` in every layout, because in both the
stacked and the scrolling case an un-pinned nav ends up off screen.

The document is a **notepad**: one continuous page of text, no rules between
days, no chips, no card edges, nothing to expand. Anything you can operate —
the add row, the kind dropdown, the link field, lock — stays invisible until
the pointer is on the day it belongs to, so at rest the column reads rather
than presents.

The document *reads* like a word processor and is edited in place, but it is not
a text buffer: every keystroke lands in a typed field. Parsing prose back into
structure happens in exactly one place, the Source panel, where it has an
`unparsed` list and a drift table to be honest with. See the header comment in
`views/Itinerary.jsx`.

Structure inside the document — the city, the bed, the trains — is derived and
read-only there. Clicking any of it opens the panel that owns it, so the
document doubles as navigation.

### The shelf

Across the top sits `openQuestions(trip)`: what nobody has settled yet, phrased
as the decision rather than the chore, each one a way into the panel that
answers it. It replaced a numbered 1–5 stepper, which implied an order that
planning a trip does not have — you pick a city, that changes the flight, the
flight changes the dates, round again. Nothing on the shelf is ticked off; an
entry leaves because the trip changed. `blocking` marks the questions that make
other questions unanswerable, not merely unanswered.

`PHASES` and `phaseState` both survive: the trip list still shows five progress
dots, and each tab still carries its own state dot.

## The ribbon

The timeline sits at the top of the workbench column and gains a layer as each
phase produces
something — trip span, flights, cities, stays, then ticks on the days that have
anything on them. The layer belonging to the phase you are on is the interactive
one (picking dates, dragging city boundaries); the rest are context.

Layer order is Trip, **Travel**, **Hotels**, Cities, Days.

- **Travel** is one clickable point per actual movement — each flight leg, each
  train — placed on its own date. Not a bar across the trip: a return flight is
  two separate things that happen on two separate days. Flights are derived from
  the chosen option in phase 2; everything else lives in `trip.travel` and is
  entered under "Getting around". A leg whose date falls outside the trip is
  pinned to the nearest edge in warning colours rather than dropped — a flight
  that disagrees with your dates is exactly what you need to see.
- **Hotels** sits *above* Cities on purpose: a day trip changes where you spend a
  day but not where you sleep that night, so the hotel row stays legible as the
  thing that outlasts the day's location. Bars read `City — Hotel`.
- **Cities** carries day trips as chips riding on top of the stop they belong to.
  Both they and the segment bars set `grid-row: 1` explicitly; without it, grid
  auto-placement pushes the chip onto a second line.

**Everything on the calendar is clickable**, and the detail opens beneath it: a
Travel point gives the leg and its confirmation, a Hotels bar the booking, a
**Cities** bar that stop's arrive/depart dates plus every note and plan across
its days. Both the **date in the header** and the **Days tick** open the same
day panel: which day of the trip it is, the city (or both cities on a travel
day), every movement with its confirmation, the hotel you check out of and into,
the notes, and the activities.

While dates are unlocked — and always on the Dates phase — it spans the whole
shopping window with the trip highlighted inside it. Once locked and working
downstream it narrows to the trip itself. `TripTimeline` handles the index
offset between those two frames; `Timeline` just renders layers.

Month captions sit above the day numbers, and full-height rules mark week
boundaries (Sunday starts a week). The rules are one absolutely-positioned grid
behind the layers rather than a border on each row, so adding a layer never
disturbs them.

## The four panels, and the days

1. **Dates** — a soft window in, locked start/end out. `dates.start/end` are the
   working values, edited by clicking the ribbon; `dates.locked` is the
   commitment everything downstream reads. The weekday count is a PTO note, not
   a balance tracker; holidays only subtract from it.
2. **Transport** — "Your transportation" comes first: every leg in date order,
   flights and trains together, with confirmations, links and what was paid.
   Searching and price-checking sit *below* that and are put away entirely once a
   flight is booked (there is a "shop anyway" escape hatch). Booking captures the
   confirmation ref, the price actually paid and its currency, the booking link
   and any notes — after that the fare is a fact, not a quote. One fare covers
   both legs, so `travelLegs` hangs the total on the outbound only; listing it on
   each leg reads as double the money.
3. **Cities** — ordered `{city, nights}` segments laid on the ribbon. Drag the
   right edge of a bar to move a night to or from its neighbour; the last bar's
   edge changes the total. Rows reorder by dragging (or arrow keys on the grip).
   Each city **locks independently**: `moveBoundary` and `resizeLast` refuse to
   touch a locked segment, and the phase only reads as done when the nights add
   up *and* every city is locked — nights adding up is not the same as having
   decided. Flags a first or last city that disagrees with the booked flight's
   airports.
4. **Stays** — candidate places per city segment, dates derived from the segment,
   with Google Maps links for hotels in that city. Plain on purpose, until using
   it shows what it should be.
5. **Days** — no longer a panel. The itinerary document *is* the days: one
   section each with its derived city, free notes and items, always expanded.
   Undone tickets and reservations are counted on the shelf instead of gathering
   into a second list. Adding an item does not ask what kind it is — the row's
   own dropdown decides that.

## Money

Every amount is a pair: a number and its currency (`USD EUR GBP CHF JPY`), on
stays, transport, day items and the flight booking. The trip has a
`baseCurrency` it is reported in and a `rates` table **you** keep — nothing here
calls a rate service, because a wrong rate you can see and edit beats a stale one
fetched behind your back. The rate used is shown next to any converted total.

`costLines()` turns the whole trip into auditable rows; `costSummary()` groups
them and splits **paid** from **still to pay**. `tripCost()` is derived from the
same call, so the header number and the breakdown can never disagree. Clicking
the header total opens that breakdown.

"Paid" means money actually gone — a booked flight, a Booked stay, a ticked-off
ticket — not merely a choice made.

## Travel days

A stop of N nights arriving on day D has you sleeping there D..D+N-1 and waking
there D+1..D+N. So **the day a stop begins is a travel day**: you wake in the old
city and go to sleep in the new one. `dayStay(t, iso)` returns
`{wake, sleep, moves, arrival, departure}` and `travelDays(t)` lists the
boundaries. All derived — never stored, so it cannot drift from the plan.

Dates are labelled **arrive** and **depart** everywhere, never a bare range, and
the calendar rules every day (not just weeks) so a bar ending mid-week still
reads as ending on a particular day.

### Half-day columns

Each day on the calendar is **two grid columns**, so a bar can stop at midday.
You arrive in a city during the day and leave during the day, so a stop runs
from the middle of its arrival day to the middle of its departure day. Three
things fall out of that, and they are the reason for the extra columns:

- a travel day reads as half the old city and half the new one;
- consecutive stops tile exactly, meeting on the seam rather than butting at a
  day boundary or leaving a gap;
- the trip's first morning and last evening are visibly empty, which is true.

`Timeline.jsx` exposes `colStart(i)`, `colMid(i)`, `colEnd(i)` and `wholeDay(i)`
for this. Anything spanning whole days (the trip bar, travel points, day ticks,
the day picker, the rules) uses `wholeDay`; stops and hotel bars use
`colMid`-to-`colMid`. Hotel bars opt in with `half: true`.

## Storage, and the trap that shapes it

```
data/index.json        { schema, trips: [entry], prefs }
data/trips/<id>.json   one full trip
```

The `artifact` files form publishes only changed paths. But per its contract,
*relative URLs in a view still serve the version it loaded* — so after this page
saves, its own `fetch("./data/trips/x.json")` returns pre-save content, and a trip
file created this session 404s. Lazy-loading a trip on open would therefore read
stale or missing data. **The page loads every trip at boot and holds them in
memory; saves are write-through.** Don't "optimise" that into lazy loading.

`data/state.json` from v1 (one trip, `{cfg, options}`) is migrated on first load
and left in place as a backup.

## Backups

A published page **cannot write to disk on its own** — `downloads.save` always
shows the viewer a confirmation, and there is no silent path. So safety is three
layers, under `#/backup`:

1. **Snapshots** — a rolling 25, pushed on every save into `localStorage`,
   coalesced so a burst of typing makes one entry. No permission, no network:
   this is the real autosave, and the fast undo.
2. **A file** — one click, one confirmation, a real `.json` on disk. Needs the
   `downloads` capability declared at publish time.
3. **Copy JSON** — paste it to Claude, which can commit it to this repo.

Snapshots are per-browser. They are not the archive; the file is.

## How the price check works

Headline prices on a Google Flights search page are the cheapest economy fare —
on a transatlantic ticket, normally the airline's basic no-frills brand. The
named brands (Main Classic, Comfort Extra…) only exist on the booking-options
page, which you reach once **both** legs are chosen. That choice is encoded in
the `tfs` URL, so the page can jump straight there given two flight numbers.

1. **search page** → expand the row at the outbound time, read its flight number
2. **leg-1-chosen page** → same trick for the return leg
3. **both-chosen page** → read the whole fare ladder

Flight numbers are cached on the option, so stages 1 and 2 run only on an
option's first check; after that a refresh is a single page load. The button
shows the cost either way.

Two things to know about the scraping:

- **This Browserless plan caps a session at 60 seconds**, so each stage must be
  its own call. Don't try to chain them inside one function.
- Each stage polls for *the structure it needs* before reading. An earlier
  version waited for `/\$\d/ && /hr/`, which matches while the page still says
  "Loading results" — that produced intermittent empty reads.
- The same trip is routinely resold by codeshare partners at a single unbranded
  price. `parseFares` prefers the block with the most named brands, which picks
  the operating carrier without needing to be told.

## Two backends, one interface

`loadAll()`, `makeSaver()`, `auth` and `HOSTED` are all either adapter exports.
Views never know which is in play; they ask `HOSTED` only to say something true
to the reader (the hosted build explains that fare search lives in Claude, and
downloads a file directly instead of asking permission for it).

The artifact backend has no accounts (`auth.enabled === false`) and no live
channel (`watchAll === null`). The Firestore backend has both, and leans on
Firestore's own local cache for offline rather than reimplementing it.

Deviations from the root `CLAUDE.md` convention, and why:

- **React is bundled, not linked from a CDN.** Artifacts block external hosts
  outright, and bundling also makes the hosted build work on a plane.
- **Two build outputs instead of one file.** The alternative was two codebases
  drifting apart.
- The data cannot be shared between the two: an artifact cannot reach
  `firestore.googleapis.com` (CSP), so moving means moving. `backups → Copy JSON`
  on one side, `Restore from JSON` on the other.
