---
name: trip-doc-sync
description: Fold an update from the Google planning doc into the live Trip Desk app at invinceable17.github.io/trip-desk — reading the trip as it stands, diffing it against the doc, importing through the Source panel, and fixing what the importer can't reach. Use this whenever the user pastes itinerary text, planning-doc contents, or hotel/flight/booking details and wants a trip brought up to date, and also for phrasings like "my wife updated the doc", "here's the latest plan", "intake this", "sync the doc", "correct my Italy trip", or "can you put this in the app". Reach for it even when they never say "Trip Desk", "import", or "sync" by name — a pasted itinerary that mentions hotels, confirmation numbers, or day-by-day plans is almost always this job.
---

# Pulling a doc update into Trip Desk

The doc is the source of truth; the trip is a structured view of it. Someone
else writes the doc, so your job is to carry their edits across **without
trampling detail the app holds that the doc has never mentioned**. Almost every
mistake in this workflow is a variant of overwriting something good.

Work through the app's own UI in the user's Chrome. Their Google session lives
there, and the app writes to Firestore under their identity.

## The shape of the job

1. Back up the trip.
2. Open the app, confirm it is signed in and writing.
3. Read the trip as it currently stands.
4. Diff it against the doc, in your head, before touching anything.
5. Build a JSON patch and apply it through the Source panel.
6. Fix by hand what the importer can't reach.
7. Verify by reloading.

Steps 1–4 are most of the value. An import you understood before you ran it is
easy to check; one you fired blind is not.

## 0. Back up first

Read the trip out of the app's local mirror and write it to your scratchpad. It
costs one call and it is the difference between a mistake you can undo and one
you can't.

```js
const a = JSON.parse(localStorage.getItem('tripdesk:all'));
const t = (a.trips ? Object.values(a.trips) : a).find(x => /italy/i.test(x.name));
JSON.stringify(t)
```

The browser JS tool refuses to return anything that looks like a cookie, a
query string, or base64 — and the stay `url`s are Gmail links with query
strings, so a whole-trip dump gets blocked. Pull the trip in pieces (segments,
stays, days, flights, source) and omit the `url` fields, which you are not
changing anyway.

## 1. Open and confirm it's live

Use the Chrome tools (`mcp__claude-in-chrome__*`), not the in-app browser — the
task needs the user's existing Google session. Navigate to
`https://invinceable17.github.io/trip-desk/`.

Routes are hash-based, so you can jump straight to a phase:
`#/t/<tripId>/{dates,flights,cities,stays,days}`.

Confirm the header reads **"all changes saved"** rather than "local only". That
means `MODE.SAVING` — signed in, allowlisted, writing to Firestore. The footer
says "Saved to this artifact" even on the hosted build; that string is a
copy bug in `app.jsx`, not a sign anything is wrong.

If a tab stops responding to `find`/`screenshot` (it happens), open a fresh tab
rather than fighting it, and close the wedged one.

## 2. Read the trip before you write to it

You need the current state to do two things: match the doc's entities to the
app's by name, and notice where the app already knows more than the doc.

Pull `segments`, `stays`, `travel`, `flights.options`, `days`, and
`source.fields`. `source.fields` is what the doc said at the last import — the
app compares it against live values to compute the "n differ" badge.

## 3. Build the patch as JSON, never as raw doc text

The Source panel accepts either the doc's prose or JSON. **Use JSON.**

`parseDocText` is deliberately conservative — it drops anything it doesn't
recognise into `unparsed` rather than guessing. On a real planning doc that
means it catches very little: a past run on this doc recognised three `Hotel:`
lines, created two duplicate hotels under the doc's spelling, and filed a
booking-confirmation line as an activity on a day. Nothing was wrong with the
parser; prose just isn't a form.

`parseDocJson` takes exactly what you give it. You are the model that
`importPrompt()` in `src/doc-parse.js` is written to address, so do that job
properly instead of making the heuristics guess. The shape:

```json
{
  "name": "...",
  "dates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "travelers": 2,
  "segments": [{ "city": "Rome", "nights": 3 }],
  "stays": [{ "name": "", "city": "", "url": "", "ref": "", "total": "", "notes": "" }],
  "days": { "YYYY-MM-DD": { "notes": "", "items": [{ "title": "", "time": "", "cost": "", "url": "", "kind": "idea" }] } },
  "text": "the doc's full text",
  "docUrl": "...",
  "docTitle": "..."
}
```

`kind` is one of `idea`, `ticket`, `reservation`, `tip`. Omit any key the doc
doesn't speak to — `applyDoc` skips empty values, so omission is how you say
"leave this alone". Include `text` with the doc's full contents; it is stored as
`source.text`, the record of what the doc actually said.

### The rules that keep an import from doing damage

**Reuse the app's existing names.** `applyDoc` matches hotels and cities by a
normalised name key, so "Hotel Odeon" and "Hotel Odeon Napoli" are two different
hotels to it, and a rename in the doc reads as a replacement. This is deliberate
— see the comment above `key()` in `doc-sync.js` — but it means you must write
the doc's *facts* under the *app's* names, or you will silently create
duplicates.

**Never send `segments`.** Segments lay onto the trip sequentially from the trip
start date, so changing nights shifts every city after it. The doc states hotel
night counts, which are not the same thing (see "This trip" below). Cities
change rarely; when they genuinely do, edit them by hand in the Cities phase
where you can see the calendar react.

**Merge notes, don't replace them.** In "doc wins" mode `put()` overwrites. Stay
notes often carry things the doc has never mentioned — "Breakfast included,
70.00 city tax". If you send a `notes` value, it must already contain what's
there.

**Prefer day items over day notes.** Notes get overwritten; items are additive
and de-duplicated by title, so they're the safe channel. Day notes frequently
hold richer plans than the doc — a wine tour on a day the doc labels only
"Florence". Leave them.

**Omit `url` on stays.** The app's stay links point at Gmail booking
confirmations, which are more useful than a hotel's homepage. Put the hotel's
own site in `notes` instead.

**Put addresses, check-in times and the doc's night counts in `notes`.** They
have nowhere else to live, and they're the details you actually want on your
phone at a front desk.

## 4. Apply it

Source bar → **link a doc** / **pull update** → paste into the textarea → **read
it**.

Check the "What it found" preview before applying. It lists the hotels by name —
if you see a name that isn't already on the trip, you are about to create a
duplicate; fix the JSON and re-read. Then **bring this in**. The confirmation
reports what changed ("6 added, 5 updated"); sanity-check that count against
what you expected.

Leave the mode selector on **the doc wins**. "keep what's here" only records
what the doc said without applying it, which is for settling a disagreement, not
for a normal pull.

## 5. What the importer can't reach

**Flights and trains.** Not in the import shape at all. Transport phase, by
hand. Flight legs are behind **Edit** on the option card; **Save option** to
commit. If you change a departure time, fix "Total time" to match or the record
becomes internally inconsistent.

**Deletions.** Import is additive by design: dropping a line from the doc must
not delete a plan you may have already booked. Remove things through the UI.

**Stays with no `segmentId` are invisible.** `Stays.jsx` only renders stays
grouped under a segment, so a stay with no city can't be seen or deleted — and
imports create them whenever the doc's hotel line isn't under a city the app
recognises. To recover one: re-import *just* that stay with a matching `city`,
which makes `applyDoc` fill in the segment, then delete it in the Stays view.

## 6. Re-check the flight

The in-app "Check price" button is inert on the hosted site. It needs the `mcp`
capability from `window.claude.use("mcp")`, which only exists inside the Claude
artifact runtime — on GitHub Pages `window.claude` is undefined, so `mcp` is
`null`.

So do the check yourself, with whatever browsing or Browserless tools you have,
and type any correction into the Transport editor. Read the current published
times for the booked flight number and date, and compare against `flights.options`.

Two things worth saying plainly to the user rather than silently "fixing":

- A flight weeks out has no live status to pull. What changes at that range is
  the *schedule*, and the airline emails about it. Treat a difference as
  something to verify against their confirmation, not as settled fact.
- If the app's stored time is internally consistent (departure + duration lands
  on the stored arrival), that's weak evidence it came from a real booking, and
  a doc that disagrees may simply have a typo. Say so; let them decide.

## 7. Verify

Reload the page and re-read. React state agreeing with you proves nothing about
what reached Firestore.

The source bar should read **PULL UPDATE** with no "n differ" badge. A badge
means a tracked field disagrees — open the panel and look. Rows marked "deleted
here" are orphans: the doc has an opinion about something no longer on the trip,
and nothing in the UI clears them. The fix is **unlink the doc** and re-import
clean, which rebuilds `source.fields` from scratch. Unlinking discards only the
field map and doc link — the trip's own values are untouched.

## This trip: Italy, October 2026

Trip id `trip_italy_2026`. Doc: "Italy 2026", `docs.google.com/document/d/1N_i1Sbs703KBa_VxGvhQi9XqN6c2V9MDcFHMX_ykqKY`.

Route: **Overnight to Rome 1n · Rome 3n · Florence 5n · Naples 4n** = 13 nights,
Sat Oct 10 → Fri Oct 23.

That first stop is not a place. The trip starts the evening they fly out of
Atlanta, so the first night is spent in the air and no city holds it. Giving it
its own one-night stop is what lets Rome start on Oct 11 and run 3 nights, which
is what the Lancelot booking actually says. It's named "Overnight to Rome" and
not "Overnight flight" on purpose: `cityMatches` checks the first stop against
the arrival airport, and without "Rome" in the name the Cities phase warns "You
land at FCO but the first stop is Overnight flight."

Consequences worth remembering:

- The doc's "3 nights, October 11-14" for Rome is already correct and already
  reflected. Do not read it as an instruction to change the segment.
- The Stays view shows an empty card for "Overnight to Rome". That's right —
  there's no hotel that night.
- All four stops are locked. Unlock before editing nights or the city name, and
  re-lock after.

Hotels, by the app's names: **Hotel Lancelot** (Rome), **Hotel Ginori al Duomo**
(Florence — the doc calls it "Hotel di Ginori al Duomo"), **Hotel Odeon Napoli**
(Naples — the doc calls it "Hotel Odeon"). Those two mismatches are exactly the
trap in §3; write to the app's spelling.

Flights are Delta DL 214 ATL→FCO and DL 279 NAP→ATL, both booked, fare recorded
on the trip rather than per-leg.

## Deploying is not part of this

This skill changes *data*, through the running app. Nothing here touches the
repo. If you do end up editing `src/`, remember `docs/` is committed build
output and pushing to `main` deploys — rebuild first, and check the last build
line reads `configured for Firebase project "..."`.
