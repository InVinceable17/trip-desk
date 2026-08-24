/* Offline checks against page text captured live during planning. */
import assert from "node:assert";
import { parseFares, parseFareBlocks, parseSearchRows, parseFlightNo, parsePaste } from "./src/parsers.js";
import { searchUrl, fareUrl, DEFAULT_CONFIG } from "./src/flights.js";
import { parseDoc, parseDocText, parseDocJson, parseDateRange, parseOneDate, importPrompt } from "./src/doc-parse.js";
import { applyDoc, driftList, compare, acceptDoc, keepMine, detach, fieldValue } from "./src/doc-sync.js";
import { readVerdict } from "./src/store-common.js";


let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { console.log(" FAIL " + name + "\n       " + e.message); process.exitCode = 1; } };

/* --------------------------------------------------- captured: fare panel */
const FARE_TEXT = `Booking options
How options are ranked
Learn more about booking options
Book with DeltaAirline
Hide options
Delta Main Classic
$2,736
Free seat selection
Standard seat
Standard boarding
Free change, possible fare difference
No refunds
1 free carry-on
1st checked bag free
Continue
Delta Main Extra
$3,086
Free seat selection
Standard seat
Standard boarding
Free change, possible fare difference
Full refunds
1 free carry-on
1st checked bag free
Continue
Delta Comfort Classic
$3,786
Free seat selection
Extra legroom
Priority boarding
Free change, possible fare difference
No refunds
1 free carry-on
1st checked bag free
Continue
Delta Comfort Extra
$4,366
Free seat selection
Extra legroom
Priority boarding
Free change, possible fare difference
Full refunds
1 free carry-on
1st checked bag free
Continue
Fare and baggage conditions apply to your entire trip. Bag fees may be higher at the airport. Delta bag policy For non-refundable fare options, taxes may be refundable.
Book with KLMAirline
$2,736
Continue
View options
Prices include required taxes + fees for 1 adult. Optional charges and bag fees may apply.
Language​English (United States)
Location​United States
CurrencyUSD`;

console.log("\nfare ladder");
ok("finds both airline blocks", () => {
  const b = parseFareBlocks(FARE_TEXT);
  assert.deepEqual(b.map((x) => x.airline), ["Delta", "KLM"]);
});
ok("reads Delta's four brands with the airline name stripped", () => {
  const { fares, airline } = parseFares(FARE_TEXT, "Delta");
  assert.equal(airline, "Delta");
  assert.deepEqual(fares, [
    { name: "Main Classic", each: 2736 },
    { name: "Main Extra", each: 3086 },
    { name: "Comfort Classic", each: 3786 },
    { name: "Comfort Extra", each: 4366 },
  ]);
});
ok("ignores the KLM codeshare block even when asked for KLM", () => {
  // KLM resells at the bare price with no named brands; falling back to the
  // richest block is correct rather than returning nothing.
  const { fares } = parseFares(FARE_TEXT, "KLM");
  assert.equal(fares.length, 4);
});
ok("picks the richest block with no airline hint", () => {
  assert.equal(parseFares(FARE_TEXT, "").fares.length, 4);
});
ok("returns empty, not garbage, on unrelated text", () => {
  assert.deepEqual(parseFares("no booking options here", "Delta").fares, []);
});

/* -------------------------------------------------- captured: search rows */
const ROWS = [
  "1:23 PM\n – \n7:55 AM+1\nUnited\n12 hr 32 min\nATL–FCO\n1 stop\n1 hr 6 min ORD\n538 kg CO2e\nAvg emissions\n$1,051\nentire trip",
  "5:00 PM\n – \n11:45 AM+1\nAir CanadaOperated by Air Canada Express - Jazz\n12 hr 45 min\nATL–FCO\n1 stop\n1 hr 59 min YYZ\n637 kg CO2e\n+18% emissions\n$1,055\nentire trip",
  "4:05 PM\n – \n7:35 AM+1\nDeltaKLM\n9 hr 30 min\nATL–FCO\nNonstop\n502 kg CO2e\n-7% emissions\n$1,441\nentire trip",
  "10:30 PM\n – \n5:20 PM+1\nBritish Airways\n12 hr 50 min\nATL–FCO\n1 stop\n1 hr 55 min LHR\n633 kg CO2e\n+17% emissions\n$1,064\nentire trip",
];

console.log("\nsearch rows");
const rows = parseSearchRows(ROWS);
ok("parses every captured row", () => assert.equal(rows.length, 4));
ok("reads the Delta nonstop correctly", () => {
  assert.deepEqual(
    (({ depart, arrive, plusOne, dur, from, to, stops, carrier, price }) =>
      ({ depart, arrive, plusOne, dur, from, to, stops, carrier, price }))(rows[2]),
    { depart: "16:05", arrive: "07:35", plusOne: true, dur: "9h 30m",
      from: "ATL", to: "FCO", stops: "nonstop", carrier: "Delta", price: 1441 },
  );
});
ok("reads a connection airport as the stop", () => {
  assert.equal(rows[0].stops, "ORD");
  assert.equal(rows[0].carrier, "United");
});
ok("trims 'Operated by' from the carrier", () => assert.equal(rows[1].carrier, "Air Canada"));
ok("keeps a genuinely two-word carrier intact", () => assert.equal(rows[3].carrier, "British Airways"));
ok("converts 12h times to 24h", () => assert.equal(rows[3].depart, "22:30"));

/* ------------------------------------------------------- flight numbers */
console.log("\nflight numbers");
ok("reads DL 214 out of a detail block", () => {
  assert.deepEqual(
    parseFlightNo("4:05 PM – 7:35 AM+1 Nonstop 9 hr 30 min ATL–FCO DeltaEconomyAirbus A330-900neoDL 214", "DL"),
    { code: "DL", num: "214" },
  );
});
ok("prefers the expected carrier code over an aircraft-like match", () => {
  assert.deepEqual(parseFlightNo("Delta DL 279 Boeing B76 seats", "DL"), { code: "DL", num: "279" });
});
ok("returns null when there is no flight number", () => {
  assert.equal(parseFlightNo("nothing here", "DL"), null);
});

/* ------------------------------------------------------------- url builder */
console.log("\nurl builder (against URLs verified live during planning)");
const seedOpt = {
  out: { date: "2026-10-10", from: "ATL", to: "FCO", flight: "DL 214", carrier: "Delta" },
  ret: { date: "2026-10-23", from: "NAP", to: "ATL", flight: "DL 279", carrier: "Delta" },
};
ok("search url is byte-identical to the verified one", () => {
  assert.equal(
    searchUrl(seedOpt),
    "https://www.google.com/travel/flights/search?tfs=CBwQAhoeEgoyMDI2LTEwLTEwagcIARIDQVRMcgcIARIDRkNPGh4SCjIwMjYtMTAtMjNqBwgBEgNOQVByBwgBEgNBVExAAUgBcAGCAQsI____________AZgBAw&hl=en&gl=US&curr=USD",
  );
});
ok("fare url is byte-identical to the verified one", () => {
  assert.equal(
    fareUrl(seedOpt),
    "https://www.google.com/travel/flights/search?tfs=CBwQAho_EgoyMDI2LTEwLTEwIh8KA0FUTBIKMjAyNi0xMC0xMBoDRkNPKgJETDIDMjE0agcIARIDQVRMcgcIARIDRkNPGj8SCjIwMjYtMTAtMjMiHwoDTkFQEgoyMDI2LTEwLTIzGgNBVEwqAkRMMgMyNzlqBwgBEgNOQVByBwgBEgNBVExAAUgBcAGCAQsI____________AZgBAw&hl=en&gl=US&curr=USD",
  );
});
ok("no fare url without flight numbers", () => {
  assert.equal(fareUrl({ out: { date: "2026-10-10", from: "ATL", to: "FCO" }, ret: {} }), null);
});

/* ---------------------------------------------------------- paste parser */
console.log("\npaste parser");
ok("reads the placeholder example from the original UI", () => {
  const r = parsePaste(
    "ATL to FCO Oct 10, 4:05pm to 7:35am+1. Naples NAP to ATL Oct 23, 9:05am to 2:39pm. Nonstop. $1,402 each.",
    DEFAULT_CONFIG,
  );
  assert.ok(r.ok, r.why);
  assert.equal(r.draft.out.date, "2026-10-10");
  assert.equal(r.draft.out.from, "ATL");
  assert.equal(r.draft.out.to, "FCO");
  assert.equal(r.draft.out.depart, "16:05");
  assert.equal(r.draft.out.arrive, "07:35");
  assert.equal(r.draft.out.plusOne, true);
  assert.equal(r.draft.ret.date, "2026-10-23");
  assert.equal(r.draft.ret.depart, "09:05");
  assert.equal(r.draft.priceEach, "1402");
});
ok("divides a stated total across travelers", () => {
  const r = parsePaste("ATL to FCO 2026-10-10 4:05pm to 7:35am, $2,804 total", DEFAULT_CONFIG);
  assert.equal(r.draft.priceEach, "1402");
});
ok("picks up a flight number", () => {
  const r = parsePaste("DL 214 ATL to FCO 2026-10-10 4:05pm to 7:35am", DEFAULT_CONFIG);
  assert.equal(r.draft.out.flight, "DL 214");
});
ok("fails honestly instead of inventing data", () => {
  const r = parsePaste("I would like to go to Italy sometime", DEFAULT_CONFIG);
  assert.equal(r.ok, false);
  assert.match(r.why, /by hand/);
});



/* ==========================================================================
   model — trips, segments, money
   ========================================================================== */
import {
  blankTrip, hydrateTrip, migrateV1, tripDays, tripNights, ptoNote,
  segmentSpans, cityForDay, moveBoundary, resizeLast, assignedNights,
  cityFlags, tripCost, phaseState, openBookings, indexEntry, blankSegment,
  blankStay, blankItem, isTransitStop, unplannedMoves, nightsBetween,
  blankTransit, transitGap, addTransit,
} from "./src/model.js";

/* The exact shape the live v1 artifact stores. */
const V1 = {
  cfg: {
    tripName: "Italy", windowStart: "2026-10-10", windowEnd: "2026-10-25",
    blockStart: "2026-10-12", blockEnd: "2026-10-23", travelers: 2,
    homeAirports: "CVG, ATL, BNA, TYS, CHA",
    destAirports: "FCO, MXP, LIN, BGY, VCE, NAP, FLR, BLQ, PSA",
  },
  options: [{
    id: "opt_seed_dl_fco_nap", name: "Delta — into Rome, out of Naples", status: "Maybe",
    priceEach: "2736", fare: "Main Classic", bookVia: "Delta",
    fares: [{ name: "Main Classic", each: 2736 }, { name: "Main Extra", each: 3086 }],
    notes: "", url: "", checks: [{ at: "2026-08-22T00:00:00.000Z", each: 2736 }],
    out: { date: "2026-10-10", from: "ATL", to: "FCO", depart: "16:05", arrive: "07:35", plusOne: true, stops: "nonstop", carrier: "Delta", flight: "DL 214", dur: "9h 30m" },
    ret: { date: "2026-10-23", from: "NAP", to: "ATL", depart: "09:05", arrive: "14:39", plusOne: false, stops: "nonstop", carrier: "Delta", flight: "DL 279", dur: "11h 34m" },
  }],
  savedAt: "2026-08-22T00:00:00.000Z",
};

console.log("\nmigration from v1");
const mig = migrateV1(V1);
ok("produces one trip named from the config", () => assert.equal(mig.name, "Italy"));
ok("keeps travelers and airports", () => {
  assert.equal(mig.travelers, 2);
  assert.match(mig.homeAirports, /ATL/);
});
ok("keeps the soft window", () => assert.deepEqual(mig.window, { start: "2026-10-10", end: "2026-10-25" }));
ok("seeds trip dates from the old time-off block, unlocked", () => {
  assert.deepEqual(mig.dates, { start: "2026-10-12", end: "2026-10-23", locked: false });
});
ok("carries the flight option across intact", () => {
  assert.equal(mig.flights.options.length, 1);
  assert.equal(mig.flights.options[0].out.flight, "DL 214");
  assert.equal(mig.flights.options[0].fares.length, 2);
});
ok("starts with nothing booked and no segments", () => {
  assert.equal(mig.flights.bookedId, null);
  assert.deepEqual(mig.segments, []);
});
ok("survives a hydrate round-trip", () => {
  assert.deepEqual(hydrateTrip(JSON.parse(JSON.stringify(mig))), mig);
});
ok("ignores junk", () => assert.equal(migrateV1(null), null));

/* ------------------------------------------------------------- a fixture */
const trip = () => {
  const t = blankTrip("Italy");
  t.dates = { start: "2026-10-12", end: "2026-10-23", locked: true }; // 11 nights
  t.travelers = 2;
  t.segments = [
    { id: "s1", city: "Rome", nights: 4, locked: false },
    { id: "s2", city: "Florence", nights: 3, locked: false },
    { id: "s3", city: "Naples", nights: 4, locked: false },
  ];
  return t;
};
/** The same trip with every city's dates settled. */
const lockedTrip = () => {
  const t = trip();
  t.segments = t.segments.map((s) => ({ ...s, locked: true }));
  return t;
};

console.log("\ntrip dates");
ok("counts nights and days", () => {
  const t = trip();
  assert.equal(tripNights(t), 11);
  assert.equal(tripDays(t).length, 12); // arrival through departure inclusive
});
ok("PTO note counts weekdays, not the whole trip", () => {
  const t = trip();
  const p = ptoNote(t);
  // Oct 12 2026 is a Monday; Oct 12-23 holds 10 weekdays and 2 weekend days.
  assert.equal(p.pto, 10);
  assert.equal(p.weekendDays, 2);
});
ok("a listed holiday comes off the PTO count", () => {
  const t = trip();
  t.holidays = ["2026-10-12"];
  assert.equal(ptoNote(t).pto, 9);
});

console.log("\nsegments");
ok("lays segments out from the arrival date", () => {
  const s = segmentSpans(trip());
  assert.deepEqual(s.map((x) => [x.seg.city, x.startIdx, x.nights]),
    [["Rome", 0, 4], ["Florence", 4, 3], ["Naples", 7, 4]]);
  assert.equal(s[0].startDate, "2026-10-12");
  assert.equal(s[1].startDate, "2026-10-16");
  assert.equal(s[2].endDate, "2026-10-23");
});
ok("assigned nights match the trip length", () => {
  const t = trip();
  assert.equal(assignedNights(t.segments), tripNights(t));
});
ok("unlocked cities are flagged even when the nights add up", () => {
  assert.match(cityFlags(trip()).join(" "), /3 of 3 cities still unlocked/);
});
ok("no flags once every city is locked", () => {
  assert.deepEqual(cityFlags(lockedTrip()), []);
});
ok("maps a day in the middle to its city", () => {
  assert.equal(cityForDay(trip(), "2026-10-17").city, "Florence");
});
ok("the departure day belongs to the last city", () => {
  assert.equal(cityForDay(trip(), "2026-10-23").city, "Naples");
});
ok("a day outside the trip maps to nothing", () => {
  assert.equal(cityForDay(trip(), "2026-11-01"), null);
});

console.log("\ndragging a boundary");
ok("moves one night from the next city to this one", () => {
  const t = trip();
  const next = moveBoundary(t.segments, 0, 1);
  assert.deepEqual(next.map((s) => s.nights), [5, 2, 4]);
});
ok("conserves the total in both directions", () => {
  const t = trip();
  for (const d of [1, 2, -1, -2]) {
    assert.equal(assignedNights(moveBoundary(t.segments, 1, d)), 11, `delta ${d}`);
  }
});
ok("never shrinks a city below one night", () => {
  const t = trip();
  assert.deepEqual(moveBoundary(t.segments, 0, 99).map((s) => s.nights), [6, 1, 4]);
  assert.deepEqual(moveBoundary(t.segments, 0, -99).map((s) => s.nights), [1, 6, 4]);
});
ok("ignores a boundary that isn't there", () => {
  const t = trip();
  assert.deepEqual(moveBoundary(t.segments, 2, 1), t.segments);
});
ok("resizing the last segment is the only edit that changes the total", () => {
  const t = trip();
  assert.equal(assignedNights(resizeLast(t.segments, 2)), 13);
  assert.equal(assignedNights(resizeLast(t.segments, -1)), 10);
});
ok("flags nights that don't add up", () => {
  const t = trip();
  t.segments = [{ id: "s1", city: "Rome", nights: 3 }];
  assert.match(cityFlags(t).join(" "), /8 nights unassigned/);
});
ok("flags a city that disagrees with the booked arrival airport", () => {
  const t = trip();
  t.flights.options = [{ ...JSON.parse(JSON.stringify(V1.options[0])) }];
  t.flights.bookedId = "opt_seed_dl_fco_nap";
  t.segments = [{ id: "s1", city: "Venice", nights: 11 }];
  assert.match(cityFlags(t).join(" "), /land at FCO but the first stop is Venice/);
});
ok("stays quiet when the city and airport agree", () => {
  const t = lockedTrip();
  t.flights.options = [{ ...JSON.parse(JSON.stringify(V1.options[0])) }];
  t.flights.bookedId = "opt_seed_dl_fco_nap";
  assert.deepEqual(cityFlags(t), []); // Rome/FCO and Naples/NAP
});

console.log("\ncost");
ok("estimates from the cheapest shortlisted flight", () => {
  const t = trip();
  t.flights.options = [
    { ...JSON.parse(JSON.stringify(V1.options[0])), id: "a", status: "Shortlist", priceEach: "1400" },
    { ...JSON.parse(JSON.stringify(V1.options[0])), id: "b", status: "Shortlist", priceEach: "1200" },
    { ...JSON.parse(JSON.stringify(V1.options[0])), id: "c", status: "Ruled out", priceEach: "100" },
  ];
  const c = tripCost(t);
  assert.equal(c.flights, 2400); // 1200 x 2 travelers
  assert.equal(c.estimated, true);
});
ok("uses the price actually paid once a flight is booked", () => {
  const t = trip();
  t.flights.options = [{ ...JSON.parse(JSON.stringify(V1.options[0])), id: "a", priceEach: "1400" }];
  t.flights.bookedId = "a";
  t.flights.booking = { ref: "ABC123", paidTotal: "2610" };
  assert.equal(tripCost(t).flights, 2610);
});
ok("adds stays and day items", () => {
  const t = trip();
  t.stays = [
    { ...blankStay("s1"), total: "900", status: "Booked" },
    { ...blankStay("s1"), total: "500", status: "Maybe" },
    { ...blankStay("s2"), total: "600", status: "Shortlist" },
  ];
  t.days = { "2026-10-13": { notes: "", items: [{ ...blankItem("ticket"), cost: "120" }, { ...blankItem(), cost: "" }] } };
  const c = tripCost(t);
  assert.equal(c.stays, 1500); // booked Rome + shortlisted Florence; Naples has none
  assert.equal(c.days, 120);
  assert.equal(c.total, c.flights + 1500 + 120);
});

console.log("\nphases and roll-ups");
ok("reports each phase's state", () => {
  const t = lockedTrip();
  assert.equal(phaseState(t, "dates"), "done");
  assert.equal(phaseState(t, "flights"), "empty");
  assert.equal(phaseState(t, "cities"), "done");
  assert.equal(phaseState(t, "stays"), "empty");
  assert.equal(phaseState(t, "days"), "empty");
});
ok("cities is only done when the nights add up", () => {
  const t = lockedTrip();
  t.segments = [{ id: "s1", city: "Rome", nights: 3, locked: true }];
  assert.equal(phaseState(t, "cities"), "started");
});
ok("cities that add up but aren't locked read as still in progress", () => {
  assert.equal(phaseState(trip(), "cities"), "started");
});

/* The real Italy shape: they leave Atlanta on the 10th and land on the 11th, so
   the route opens with a night nobody sleeps in a city. */
const redeyeTrip = () => {
  const t = blankTrip("Italy");
  t.dates = { start: "2026-10-10", end: "2026-10-23", locked: true }; // 13 nights
  t.segments = [
    { id: "s0", city: "Overnight to Rome", nights: 1, locked: true },
    { id: "s1", city: "Rome", nights: 3, locked: true },
    { id: "s2", city: "Florence", nights: 5, locked: true },
    { id: "s3", city: "Naples", nights: 4, locked: true },
  ];
  t.flights.options = [{
    id: "o1",
    out: { date: "2026-10-10", from: "ATL", to: "FCO", depart: "16:35", arrive: "07:35", plusOne: true },
    ret: { date: "2026-10-23", from: "NAP", to: "ATL", depart: "09:05", arrive: "14:39", plusOne: false },
  }];
  t.flights.bookedId = "o1";
  t.travel = [
    { id: "t1", kind: "train", date: "2026-10-14", from: "Rome", to: "Florence", booked: false },
    { id: "t2", kind: "train", date: "2026-10-19", from: "Florence", to: "Naples", booked: false },
  ];
  t.stays = [
    { id: "h1", segmentId: "s1", name: "Lancelot", status: "Booked" },
    { id: "h2", segmentId: "s2", name: "Ginori", status: "Booked" },
    { id: "h3", segmentId: "s3", name: "Odeon", status: "Booked" },
  ];
  return t;
};

ok("a night spanned by an overnight leg is a transit stop", () => {
  const t = redeyeTrip();
  assert.equal(isTransitStop(t, t.segments[0]), true);
  assert.equal(isTransitStop(t, t.segments[1]), false);
  assert.equal(isTransitStop(t, t.segments[3]), false);
});
ok("a one-night city you land in the same day still wants a bed", () => {
  const t = blankTrip("Layover");
  t.dates = { start: "2026-10-10", end: "2026-10-13", locked: true };
  t.segments = [
    { id: "s1", city: "Lisbon", nights: 1, locked: true },
    { id: "s2", city: "Porto", nights: 2, locked: true },
  ];
  t.flights.options = [{
    id: "o1",
    out: { date: "2026-10-10", from: "ATL", to: "LIS", depart: "08:00", arrive: "18:00", plusOne: false },
    ret: { date: "2026-10-13", from: "OPO", to: "ATL", depart: "10:00", arrive: "14:00", plusOne: false },
  }];
  t.flights.bookedId = "o1";
  t.stays = [{ id: "h1", segmentId: "s2", name: "Porto place", status: "Booked" }];
  assert.equal(isTransitStop(t, t.segments[0]), false);
  // Lisbon has no booked stay, and it is a real night in a real city.
  assert.equal(phaseState(t, "stays"), "started");
});
ok("stays is done when every city you sleep in is booked", () => {
  // The transit stop has no hotel and must not hold the phase open.
  assert.equal(phaseState(redeyeTrip(), "stays"), "done");
});
ok("transport stays open while a move between cities is unbooked", () => {
  const t = redeyeTrip();
  assert.deepEqual(unplannedMoves(t).map((d) => d.iso), ["2026-10-14", "2026-10-19"]);
  // A booked flight is not enough on its own.
  assert.equal(phaseState(t, "flights"), "started");
});
ok("the day you land needs no ground leg of its own", () => {
  const t = redeyeTrip();
  // Oct 11 is a change of city, but the flight already makes that move.
  assert.equal(unplannedMoves(t).some((d) => d.iso === "2026-10-11"), false);
});
ok("transport is done once the trains are booked too", () => {
  const t = redeyeTrip();
  t.travel = t.travel.map((x) => ({ ...x, booked: true }));
  assert.deepEqual(unplannedMoves(t), []);
  assert.equal(phaseState(t, "flights"), "done");
});
ok("collects everything still to book, in date order", () => {
  const t = trip();
  t.days = {
    "2026-10-20": { notes: "", items: [{ ...blankItem("ticket"), title: "Pompeii", done: false }] },
    "2026-10-14": { notes: "", items: [
      { ...blankItem("reservation"), title: "Dinner", done: false },
      { ...blankItem("ticket"), title: "Uffizi", done: true },
      { ...blankItem("idea"), title: "Wander", done: false },
    ] },
  };
  assert.deepEqual(openBookings(t).map((i) => i.title), ["Dinner", "Pompeii"]);
});
ok("builds an index entry the browser view can render", () => {
  const t = trip();
  const e = indexEntry(t);
  assert.equal(e.name, "Italy");
  assert.equal(e.dest, "Rome · Florence · Naples");
  assert.equal(e.start, "2026-10-12");
  assert.equal(e.locked, true);
});



console.log("\nadding cities");
import { addSegment } from "./src/model.js";
ok("the first city takes the whole trip", () => {
  assert.deepEqual(addSegment([], "Rome", 11).map((s) => [s.city, s.nights]), [["Rome", 11]]);
});
ok("a later city takes the unassigned nights", () => {
  const segs = addSegment([{ id: "a", city: "Rome", nights: 7 }], "Florence", 11);
  assert.deepEqual(segs.map((s) => s.nights), [7, 4]);
});
ok("with nothing spare it borrows from the roomiest city", () => {
  const segs = addSegment([{ id: "a", city: "Rome", nights: 11 }], "Florence", 11);
  assert.deepEqual(segs.map((s) => [s.city, s.nights]), [["Rome", 10], ["Florence", 1]]);
  assert.equal(assignedNights(segs), 11);
});
ok("never overflows the trip while a donor exists", () => {
  let segs = [{ id: "a", city: "Rome", nights: 11 }];
  for (const c of ["Florence", "Naples", "Siena"]) segs = addSegment(segs, c, 11);
  assert.equal(assignedNights(segs), 11);
});
ok("ignores an empty city name", () => {
  assert.deepEqual(addSegment([], "  ", 11), []);
});



console.log("\nseeding an empty desk");
import { seedTrips } from "./src/model.js";
ok("restores the Italy trip", () => {
  const [t] = seedTrips();
  assert.equal(t.name, "Italy");
  assert.equal(t.travelers, 2);
  assert.deepEqual(t.window, { start: "2026-10-10", end: "2026-10-25" });
});
ok("carries the Delta option with the fares scraped on 22 Aug", () => {
  const [t] = seedTrips();
  const o = t.flights.options[0];
  assert.equal(o.out.flight, "DL 214");
  assert.equal(o.ret.flight, "DL 279");
  assert.equal(o.priceEach, "2736");
  assert.deepEqual(o.fares.map((f) => f.each), [2736, 3086, 3786, 4366]);
});
ok("leaves the dates unlocked for phase 1 to confirm", () => {
  assert.equal(seedTrips()[0].dates.locked, false);
});
ok("costs out at the live Main Classic fare for two", () => {
  assert.equal(tripCost(seedTrips()[0]).flights, 5472);
});
ok("the seed is a valid trip in its own right", () => {
  const [t] = seedTrips();
  assert.deepEqual(hydrateTrip(JSON.parse(JSON.stringify(t))), t);
});



/* ==========================================================================
   locking, reordering, and day trips
   ========================================================================== */
console.log("\nlocking a city's dates");
import { moveSegment, citiesLocked, dayTrips, hotelsIn, mapsSearch, blankDay } from "./src/model.js";

ok("a locked city won't give up nights to its neighbour", () => {
  const segs = [
    { id: "a", city: "Rome", nights: 4, locked: true },
    { id: "b", city: "Florence", nights: 3, locked: false },
  ];
  assert.deepEqual(moveBoundary(segs, 0, 2), segs);
});
ok("a locked city won't take nights either", () => {
  const segs = [
    { id: "a", city: "Rome", nights: 4, locked: false },
    { id: "b", city: "Florence", nights: 3, locked: true },
  ];
  assert.deepEqual(moveBoundary(segs, 0, -2), segs);
});
ok("two unlocked neighbours still trade freely", () => {
  const segs = [
    { id: "a", city: "Rome", nights: 4, locked: false },
    { id: "b", city: "Florence", nights: 3, locked: false },
  ];
  assert.deepEqual(moveBoundary(segs, 0, 1).map((s) => s.nights), [5, 2]);
});
ok("a locked last city can't be resized", () => {
  const segs = [{ id: "a", city: "Rome", nights: 4, locked: true }];
  assert.deepEqual(resizeLast(segs, 3), segs);
});
ok("citiesLocked needs every city, not just some", () => {
  assert.equal(citiesLocked(trip()), false);
  assert.equal(citiesLocked(lockedTrip()), true);
  assert.equal(citiesLocked({ segments: [] }), false);
});
ok("new cities start unlocked", () => {
  assert.equal(addSegment([], "Rome", 5)[0].locked, false);
});

console.log("\nreordering cities");
ok("moves a city later in the order", () => {
  const t = trip();
  assert.deepEqual(moveSegment(t.segments, 0, 2).map((s) => s.city), ["Florence", "Naples", "Rome"]);
});
ok("moves a city earlier in the order", () => {
  const t = trip();
  assert.deepEqual(moveSegment(t.segments, 2, 0).map((s) => s.city), ["Naples", "Rome", "Florence"]);
});
ok("reordering never changes the nights", () => {
  const t = trip();
  assert.equal(assignedNights(moveSegment(t.segments, 2, 0)), 11);
});
ok("ignores a move that goes nowhere or out of bounds", () => {
  const t = trip();
  assert.deepEqual(moveSegment(t.segments, 1, 1), t.segments);
  assert.deepEqual(moveSegment(t.segments, 0, 9), t.segments);
  assert.deepEqual(moveSegment(t.segments, -1, 0), t.segments);
});

console.log("\nday trips");
ok("a day with no override sits in the city it sleeps in", () => {
  const w = cityForDay(trip(), "2026-10-13");
  assert.equal(w.city, "Rome");
  assert.equal(w.base, "Rome");
  assert.equal(w.dayTrip, false);
});
ok("an override moves the day without moving the night", () => {
  const t = trip();
  t.days = { "2026-10-14": { ...blankDay(), city: "Pompeii" } };
  const w = cityForDay(t, "2026-10-14");
  assert.equal(w.city, "Pompeii");
  assert.equal(w.base, "Rome");        // still sleeping in Rome
  assert.equal(w.dayTrip, true);
  assert.equal(w.segmentId, "s1");     // so the Rome booking still applies
});
ok("naming the city you're already in is not a day trip", () => {
  const t = trip();
  t.days = { "2026-10-14": { ...blankDay(), city: "rome" } };
  assert.equal(cityForDay(t, "2026-10-14").dayTrip, false);
});
ok("collects every day trip in order", () => {
  const t = trip();
  t.days = {
    "2026-10-20": { ...blankDay(), city: "Capri" },
    "2026-10-14": { ...blankDay(), city: "Pompeii" },
  };
  assert.deepEqual(dayTrips(t).map((d) => [d.iso, d.city, d.base]),
    [["2026-10-14", "Pompeii", "Rome"], ["2026-10-20", "Capri", "Naples"]]);
});
ok("a day trip doesn't disturb the stay for that segment", () => {
  const t = trip();
  t.days = { "2026-10-14": { ...blankDay(), city: "Pompeii" } };
  t.stays = [{ ...blankStay("s1"), name: "Hotel Artemide", total: "900", status: "Booked" }];
  assert.equal(tripCost(t).stays, 900);
});

console.log("\nmaps links");
ok("builds a hotel search for a city", () => {
  assert.equal(hotelsIn("Rome"), "https://www.google.com/maps/search/hotels%20in%20Rome");
});
ok("escapes a two-word city", () => {
  assert.match(hotelsIn("San Gimignano"), /San%20Gimignano/);
});
ok("no link without a city", () => assert.equal(hotelsIn(""), null));
ok("plain search for anywhere else", () => {
  assert.match(mapsSearch("things to do in Capri"), /things%20to%20do%20in%20Capri/);
});



/* ==========================================================================
   travel legs, day-trip plumbing, and backups
   ========================================================================== */
console.log("\ntravel legs");
import { travelLegs, blankTravel, cityPlan, setDayTrip, daysLocked, lockedDayCount } from "./src/model.js";
import { exportBundle, importBundle } from "./src/store.js";

const flown = () => {
  const t = lockedTrip();
  t.flights.options = [JSON.parse(JSON.stringify(V1.options[0]))];
  t.flights.bookedId = "opt_seed_dl_fco_nap";
  t.flights.booking = { ref: "HJ4K2P", paidTotal: "5240" };
  return t;
};

ok("a return flight becomes two legs, not one bar", () => {
  const legs = travelLegs(flown());
  assert.equal(legs.length, 2);
  assert.deepEqual(legs.map((l) => [l.date, l.from, l.to]),
    [["2026-10-10", "ATL", "FCO"], ["2026-10-23", "NAP", "ATL"]]);
});
ok("each leg knows it is a flight and that it is booked", () => {
  const legs = travelLegs(flown());
  assert.ok(legs.every((l) => l.kind === "flight" && l.booked));
  assert.equal(legs[0].ref, "DL 214");
});
ok("trains join the same list, in date order", () => {
  const t = flown();
  t.travel = [
    { ...blankTravel("train"), date: "2026-10-19", from: "Florence", to: "Naples", ref: "FR 9512" },
    { ...blankTravel("train"), date: "2026-10-16", from: "Rome", to: "Florence", ref: "FR 9430" },
  ];
  assert.deepEqual(travelLegs(t).map((l) => `${l.kind}:${l.date}`),
    ["flight:2026-10-10", "train:2026-10-16", "train:2026-10-19", "flight:2026-10-23"]);
});
ok("a leg with no date is left off the calendar", () => {
  const t = flown();
  t.travel = [blankTravel("ferry")];
  assert.equal(travelLegs(t).length, 2);
});
ok("no flights and no travel means no legs", () => {
  assert.deepEqual(travelLegs(lockedTrip()), []);
});
ok("booked travel costs roll into the total", () => {
  const t = flown();
  t.travel = [{ ...blankTravel("train"), date: "2026-10-16", cost: "88", booked: true }];
  assert.equal(tripCost(t).flights, 5240 + 88);
});

console.log("\nday trips in the city plan");
ok("the plan interleaves day trips under the stop they belong to", () => {
  let t = lockedTrip();
  t = setDayTrip(t, "2026-10-14", "Pompeii");   // Rome nights 12-15
  t = setDayTrip(t, "2026-10-21", "Capri");     // Naples nights 19-22
  assert.deepEqual(cityPlan(t).map((r) => `${r.type}:${r.type === "base" ? r.seg.city : r.city}`),
    ["base:Rome", "trip:Pompeii", "base:Florence", "base:Naples", "trip:Capri"]);
});
ok("a day trip carries the stop it is out of", () => {
  const t = setDayTrip(lockedTrip(), "2026-10-14", "Pompeii");
  const row = cityPlan(t).find((r) => r.type === "trip");
  assert.equal(row.base, "Rome");
  assert.equal(row.iso, "2026-10-14");
});
ok("clearing a day trip removes the row", () => {
  let t = setDayTrip(lockedTrip(), "2026-10-14", "Pompeii");
  t = setDayTrip(t, "2026-10-14", "");
  assert.equal(cityPlan(t).filter((r) => r.type === "trip").length, 0);
});
ok("day trips never change the nights a stop owns", () => {
  const t = setDayTrip(lockedTrip(), "2026-10-14", "Pompeii");
  assert.equal(assignedNights(t.segments), 11);
});

console.log("\nlocking days");
ok("a fresh trip has no locked days", () => {
  assert.equal(lockedDayCount(lockedTrip()), 0);
  assert.equal(daysLocked(lockedTrip()), false);
});
ok("a couple of filled-in days is not a finished itinerary", () => {
  const t = lockedTrip();
  t.days = {
    "2026-10-13": { ...blankDay(), notes: "Forum", locked: true },
    "2026-10-14": { ...blankDay(), items: [blankItem("ticket")] },
  };
  assert.equal(phaseState(t, "days"), "started");
});
ok("days is done only when every day is locked", () => {
  const t = lockedTrip();
  t.days = {};
  tripDays(t).forEach((iso) => { t.days[iso] = { ...blankDay(), locked: true }; });
  assert.equal(lockedDayCount(t), 12);
  assert.equal(daysLocked(t), true);
  assert.equal(phaseState(t, "days"), "done");
});
ok("one unlocked day is enough to keep it in progress", () => {
  const t = lockedTrip();
  t.days = {};
  tripDays(t).forEach((iso, i) => { t.days[iso] = { ...blankDay(), locked: i > 0 }; });
  assert.equal(phaseState(t, "days"), "started");
});

console.log("\nbackup round-trip");
ok("a bundle survives export and import", () => {
  const t = flown();
  const db = { trips: { [t.id]: t }, order: [t.id], prefs: { seeded: true } };
  const back = importBundle(exportBundle(db));
  assert.equal(back.order.length, 1);
  assert.equal(back.trips[t.id].name, t.name);
  assert.equal(back.trips[t.id].flights.booking.ref, "HJ4K2P");
  assert.equal(back.trips[t.id].segments.length, 3);
});
ok("an older bundle missing new fields still opens", () => {
  const old = JSON.stringify({ trips: [{ id: "x", name: "Old", dates: { start: "", end: "" } }] });
  const back = importBundle(old);
  assert.ok(Array.isArray(back.trips.x.travel));
  assert.equal(back.trips.x.name, "Old");
});
ok("junk is refused rather than half-imported", () => {
  assert.equal(importBundle("not json"), null);
  assert.equal(importBundle("{}"), null);
});



/* ==========================================================================
   currency, cost breakdown, and travel days
   ========================================================================== */
console.log("\ncurrency");
import { fmtMoney, toBase, costLines, costSummary, dayStay, travelDays } from "./src/model.js";

ok("formats each currency with its own symbol", () => {
  assert.equal(fmtMoney(1200, "USD"), "$1,200");
  assert.equal(fmtMoney(1200, "EUR"), "€1,200");
  assert.equal(fmtMoney(1200, "GBP"), "£1,200");
});
ok("converts into the trip's base using the trip's own rates", () => {
  const t = lockedTrip();
  assert.equal(Math.round(toBase(t, 100, "EUR")), 108);
  assert.equal(toBase(t, 100, "USD"), 100);
});
ok("an edited rate changes the conversion", () => {
  const t = { ...lockedTrip(), rates: { USD: 1, EUR: 1.5 } };
  assert.equal(Math.round(toBase(t, 100, "EUR")), 150);
});
ok("reporting in another base flips the maths", () => {
  const t = { ...lockedTrip(), baseCurrency: "EUR" };
  assert.equal(Math.round(toBase(t, 108, "USD")), 100);
});

console.log("\ncost breakdown");
const priced = () => {
  const t = lockedTrip();
  t.flights.options = [{ ...JSON.parse(JSON.stringify(V1.options[0])), id: "f1", priceEach: "1400" }];
  t.flights.bookedId = "f1";
  t.flights.booking = { ref: "HJ4K2P", paidTotal: "2610", currency: "USD", url: "", notes: "" };
  t.travel = [{ ...blankTravel("train"), id: "x1", date: "2026-10-16", from: "Rome", to: "Florence", cost: "96", currency: "EUR", booked: true }];
  t.stays = [
    { ...blankStay("s1"), id: "h1", name: "Artemide", total: "900", currency: "EUR", status: "Booked" },
    { ...blankStay("s2"), id: "h2", name: "Guadagni", total: "600", currency: "EUR", status: "Shortlist" },
  ];
  t.days = { "2026-10-13": { ...blankDay(), items: [
    { ...blankItem("ticket"), id: "i1", title: "Colosseum", cost: "36", currency: "EUR", done: true },
    { ...blankItem("ticket"), id: "i2", title: "Borghese", cost: "25", currency: "EUR", done: false },
  ] } };
  return t;
};

ok("every priced thing becomes a line", () => {
  const lines = costLines(priced());
  assert.deepEqual(lines.map((l) => l.id).sort(),
    ["flight:f1", "item:i1", "item:i2", "stay:h1", "stay:h2", "trv:x1"]);
});
ok("lines keep their own currency and carry a base conversion", () => {
  const l = costLines(priced()).find((x) => x.id === "stay:h1");
  assert.equal(l.currency, "EUR");
  assert.equal(l.amount, 900);
  assert.equal(Math.round(l.base), 972);   // 900 EUR at 1.08
});
ok("paid means money actually gone, not merely chosen", () => {
  const lines = costLines(priced());
  const paid = lines.filter((l) => l.paid).map((l) => l.id).sort();
  assert.deepEqual(paid, ["flight:f1", "item:i1", "stay:h1", "trv:x1"]);
});
ok("a shortlisted hotel counts toward the total but not toward paid", () => {
  const s = costSummary(priced());
  const h2 = s.lines.find((l) => l.id === "stay:h2");
  assert.equal(h2.paid, false);
  assert.ok(s.due > 0);
});
ok("the split adds back up to the total", () => {
  const s = costSummary(priced());
  assert.equal(Math.round(s.paid + s.due), Math.round(s.total));
});
ok("groups the lines the way the panel shows them", () => {
  const s = costSummary(priced());
  assert.deepEqual(Object.keys(s.groups).sort(), ["Days", "Stays", "Transport"]);
  assert.equal(s.groups.Transport.n, 2);
});
ok("notices when more than one currency is in play", () => {
  assert.equal(costSummary(priced()).mixed, true);
  assert.equal(costSummary(lockedTrip()).mixed, false);
});
ok("tripCost agrees with the breakdown it is built from", () => {
  const t = priced();
  const c = tripCost(t), s = costSummary(t);
  assert.equal(c.total, s.total);
  assert.equal(c.paid, s.paid);
  assert.equal(c.estimated, true);           // the shortlisted hotel is still due
});
ok("everything paid means the total is no longer an estimate", () => {
  const t = priced();
  t.stays = t.stays.filter((x) => x.id === "h1");
  t.days["2026-10-13"].items = [t.days["2026-10-13"].items[0]];
  assert.equal(tripCost(t).estimated, false);
});

console.log("\ntravel days");
ok("the day a stop begins is a travel day", () => {
  const d = dayStay(lockedTrip(), "2026-10-16");   // Rome 4n, then Florence
  assert.equal(d.wake, "Rome");
  assert.equal(d.sleep, "Florence");
  assert.equal(d.moves, true);
});
ok("an ordinary day wakes and sleeps in the same place", () => {
  const d = dayStay(lockedTrip(), "2026-10-14");
  assert.equal(d.wake, "Rome");
  assert.equal(d.sleep, "Rome");
  assert.equal(d.moves, false);
});
ok("the arrival day has nowhere to wake up", () => {
  const d = dayStay(lockedTrip(), "2026-10-12");
  assert.equal(d.wake, "");
  assert.equal(d.sleep, "Rome");
  assert.equal(d.arrival, true);
  assert.equal(d.moves, false);
});
ok("the departure day has nowhere to sleep", () => {
  const d = dayStay(lockedTrip(), "2026-10-23");
  assert.equal(d.wake, "Naples");
  assert.equal(d.sleep, "");
  assert.equal(d.departure, true);
});
ok("there is one travel day per boundary between stops", () => {
  const t = lockedTrip();   // Rome 4 / Florence 3 / Naples 4
  assert.deepEqual(travelDays(t).map((d) => `${d.iso} ${d.wake}->${d.sleep}`),
    ["2026-10-16 Rome->Florence", "2026-10-19 Florence->Naples"]);
});
ok("moving a boundary moves the travel day with it", () => {
  const t = lockedTrip();
  t.segments = moveBoundary(t.segments.map((s) => ({ ...s, locked: false })), 0, 1);
  assert.equal(travelDays(t)[0].iso, "2026-10-17");
});
ok("a stop's arrival and departure dates are its span", () => {
  const sp = segmentSpans(lockedTrip())[1];
  assert.equal(sp.startDate, "2026-10-16");   // arrive Florence
  assert.equal(sp.endDate, "2026-10-19");     // depart Florence
});


/* ==================================================== the doc as a source */

const DOC = `Italy 2026
Oct 12 - Oct 23, 2026
2 travellers

Rome (8 nights)
Hotel: Hotel Artemide - https://example.com/artemide - conf ABC12345 - $1,840

Florence (3 nights)
Hotel: Palazzo Guadagni

Oct 12 - Rome
- Land at FCO, drop bags
- Dinner near Trastevere, $60

Oct 14
- Borghese Gallery 9:00 tickets https://example.com/borghese
`;

ok("a date range reads with the month written once", () => {
  assert.deepEqual(parseDateRange("Oct 12-23, 2026"), { start: "2026-10-12", end: "2026-10-23" });
});
ok("a date range reads with both months written", () => {
  assert.deepEqual(parseDateRange("October 12 to October 23, 2026"), { start: "2026-10-12", end: "2026-10-23" });
});
ok("a bare date resolves against the trip it is being read into", () => {
  assert.equal(parseOneDate("Oct 14", "2026-10-12"), "2026-10-14");
});
ok("the doc's title becomes the trip name", () => {
  assert.equal(parseDocText(DOC).name, "Italy 2026");
});
ok("cities and their nights come out in the doc's order", () => {
  assert.deepEqual(parseDocText(DOC).segments, [
    { city: "Rome", nights: 8 }, { city: "Florence", nights: 3 },
  ]);
});
ok("a hotel line is split into name, link, ref and total", () => {
  const s = parseDocText(DOC).stays[0];
  assert.equal(s.name, "Hotel Artemide");
  assert.equal(s.url, "https://example.com/artemide");
  assert.equal(s.ref, "ABC12345");
  assert.equal(s.total, "1840");
  assert.equal(s.city, "Rome");
});
ok("bullets land on the day heading above them", () => {
  const d = parseDocText(DOC).days;
  assert.deepEqual(d["2026-10-12"].items.map((i) => i.title), ["Land at FCO, drop bags", "Dinner near Trastevere"]);
  assert.equal(d["2026-10-12"].items[1].cost, "60");
  assert.equal(d["2026-10-14"].items[0].time, "9:00");
});
ok("travellers are read from prose", () => {
  assert.equal(parseDocText(DOC).travelers, 2);
});
ok("a line the parser does not understand is reported, not guessed at", () => {
  const p = parseDocText("Trip\nask Marco about the boat thing");
  assert.deepEqual(p.unparsed, ["ask Marco about the boat thing"]);
  assert.equal(p.segments.length, 0);
});
ok("JSON from an LLM parses into the same shape", () => {
  const p = parseDoc('```json\n{"name":"Italy","segments":[{"city":"Rome","nights":8}]}\n```');
  assert.equal(p.name, "Italy");
  assert.deepEqual(p.segments, [{ city: "Rome", nights: 8 }]);
});
ok("JSON that is not a trip fails loudly rather than importing nothing", () => {
  assert.throws(() => parseDocJson('{"unrelated":1}'), /nothing in it matched/);
});
ok("the import prompt carries the trip's existing names so nothing duplicates", () => {
  const t = blankTrip("Italy");
  t.segments = [{ id: "s1", city: "Rome", nights: 8, locked: false }];
  assert.match(importPrompt(t), /cities: Rome/);
});

/* ---------------------------------------------------------------- syncing */

const imported = () => applyDoc(blankTrip("Untitled"), parseDocText(DOC), { now: "2026-08-24T00:00:00Z", by: "Vince" }).trip;

ok("importing fills the trip and records where it came from", () => {
  const t = imported();
  assert.equal(t.name, "Italy 2026");
  assert.equal(t.segments.length, 2);
  assert.equal(t.stays[0].name, "Hotel Artemide");
  assert.equal(t.source.kind, "gdoc");
  assert.equal(t.source.syncedBy, "Vince");
});
ok("a hotel is tied to the city it was written under", () => {
  const t = imported();
  const rome = t.segments.find((s) => s.city === "Rome");
  assert.equal(t.stays[0].segmentId, rome.id);
});
ok("a freshly imported trip has no drift", () => {
  assert.deepEqual(driftList(imported()), []);
});
ok("editing an imported field here shows as drift against the doc", () => {
  const t = imported();
  t.stays = t.stays.map((s, i) => (i === 0 ? { ...s, name: "Hotel Nazionale" } : s));
  const d = driftList(t);
  assert.equal(d.length, 1);
  assert.equal(d[0].label, "Hotel");
  assert.equal(d[0].docValue, "Hotel Artemide");
  assert.equal(d[0].tripValue, "Hotel Nazionale");
});
ok("taking the doc's value clears that drift", () => {
  let t = imported();
  t.stays = t.stays.map((s, i) => (i === 0 ? { ...s, name: "Hotel Nazionale" } : s));
  t = acceptDoc(t, driftList(t)[0].path);
  assert.equal(t.stays[0].name, "Hotel Artemide");
  assert.deepEqual(driftList(t), []);
});
ok("keeping ours clears the drift without changing the trip", () => {
  let t = imported();
  t.stays = t.stays.map((s, i) => (i === 0 ? { ...s, name: "Hotel Nazionale" } : s));
  t = keepMine(t, driftList(t)[0].path);
  assert.equal(t.stays[0].name, "Hotel Nazionale");
  assert.deepEqual(driftList(t), []);
});
ok("re-importing the same doc changes nothing and adds nothing", () => {
  const once = imported();
  const twice = applyDoc(once, parseDocText(DOC), { now: "2026-08-25T00:00:00Z" });
  assert.equal(twice.added, 0);
  assert.equal(twice.updated, 0);
  assert.equal(twice.trip.segments.length, 2);
  assert.equal(twice.trip.stays.length, 2);
});
ok("a city renamed in the doc updates rather than duplicating a stop", () => {
  const once = imported();
  const p = parseDocText(DOC.replace("Florence (3 nights)", "Florence (5 nights)"));
  const { trip } = applyDoc(once, p);
  assert.equal(trip.segments.length, 2);
  assert.equal(trip.segments.find((s) => s.city === "Florence").nights, 5);
});
ok("record mode leaves a locally edited field alone but still tracks the doc", () => {
  let t = imported();
  t.stays = t.stays.map((s, i) => (i === 0 ? { ...s, total: "2000" } : s));
  const p = parseDocText(DOC.replace("$1,840", "$1,950"));
  const r = applyDoc(t, p, { mode: "record" });
  assert.equal(r.trip.stays[0].total, "2000");
  assert.equal(r.kept, 1);
  assert.equal(driftList(r.trip).find((x) => x.path.endsWith(".total")).docValue, "1950");
});
ok("a hotel renamed in the doc reads as a different hotel, not a rename", () => {
  const once = imported();
  const p = parseDocText(DOC.replace("Hotel Artemide", "Hotel Quirinale"));
  const { trip } = applyDoc(once, p);
  assert.equal(trip.stays.length, 3);
  assert.ok(trip.stays.some((s) => s.name === "Hotel Artemide"));
  assert.ok(trip.stays.some((s) => s.name === "Hotel Quirinale"));
});
ok("day plans are additive - a line dropped from the doc keeps its booking", () => {
  const once = imported();
  const p = parseDocText(DOC.replace("- Land at FCO, drop bags\n", ""));
  const { trip } = applyDoc(once, p);
  assert.equal(trip.days["2026-10-12"].items.length, 2);
});
ok("detaching forgets the doc and leaves the trip standing", () => {
  const t = detach(imported());
  assert.equal(t.source.kind, "");
  assert.equal(t.segments.length, 2);
  assert.deepEqual(driftList(t), []);
});
ok("a field whose thing was deleted here is surfaced, not dropped", () => {
  const t = { ...imported() };
  t.stays = [];
  assert.ok(compare(t).some((r) => r.state === "orphan"));
});
ok("an old trip with no source block still opens", () => {
  const t = blankTrip("Old");
  delete t.source;
  assert.deepEqual(driftList(hydrateTrip(t)), []);
});


/* ------------------------------------------------- what an empty read means */
/* Firestore returns an empty result, not an error, when it is offline with a
   cold cache. Treating that as "the workspace is new" is how a phone on a bad
   connection seeds the sample trip over a real index. */

ok("trips that came back are trusted, cached or not", () => {
  assert.equal(readVerdict({ fromCache: true, indexExists: true, tripCount: 3 }), "open");
  assert.equal(readVerdict({ fromCache: false, indexExists: true, tripCount: 3 }), "open");
});
ok("empty from the cache proves nothing and must not seed", () => {
  assert.equal(readVerdict({ fromCache: true, indexExists: true, tripCount: 0 }), "unknown");
  assert.equal(readVerdict({ fromCache: true, indexExists: false, tripCount: 0 }), "unknown");
});
ok("a desk emptied on purpose stays empty", () => {
  assert.equal(readVerdict({ fromCache: false, indexExists: true, tripCount: 0 }), "open");
});
ok("only a confirmed, never-initialised workspace seeds", () => {
  assert.equal(readVerdict({ fromCache: false, indexExists: false, tripCount: 0 }), "seed");
});
ok("a missing argument never lands on seed by accident", () => {
  assert.equal(readVerdict({ fromCache: true }), "unknown");
});

/* ----------------------------------------------------------- doc emitter */
/* doc-emit.js has one job: produce something the planning doc would recognise
   as its own. So the tests are about the format, literally — the heading
   shape, her non-standard weekday abbreviations, the indent under a hotel —
   and about the round trip, which is the only real proof that emitting and
   parsing agree with each other. */

import { blocks as emitBlocks, text as emitText, docDays, blankDays, pieces } from "./src/doc-emit.js";

console.log("\ndoc emitter");

/* The trip the real planning doc describes, as the app would hold it. */
const docTrip = () => {
  const t = blankTrip("Italy");
  t.dates = { start: "2026-10-11", end: "2026-10-23", locked: true };
  t.travelers = 2;
  t.segments = [
    { id: "s1", city: "Rome", nights: 3, locked: true },
    { id: "s2", city: "Florence", nights: 5, locked: true },
    { id: "s3", city: "Naples", nights: 4, locked: true },
  ];
  t.flights.options = [{
    id: "o1", status: "Booked", priceEach: "1402",
    out: { date: "2026-10-10", from: "ATL", to: "FCO", depart: "16:35", arrive: "07:35", plusOne: true },
    ret: { date: "2026-10-23", from: "NAP", to: "ATL", depart: "09:05", arrive: "14:39", plusOne: false },
  }];
  t.flights.bookedId = "o1";
  t.stays = [{
    ...blankStay("s1"), name: "Hotel Lancelot", url: "https://www.lancelothotel.com/",
    address: "Via Capo D'Africa, 47, Roma", ref: "2026082251320670", status: "Booked",
  }];
  return t;
};

ok("the document runs from the departure, not from trip.dates", () => {
  const t = docTrip();
  const d = docDays(t);
  // trip.dates starts on the 11th; the flight leaves on the 10th.
  assert.equal(d[0], "2026-10-10");
  assert.equal(d[d.length - 1], "2026-10-23");
  assert.equal(d.length, 14);
});
ok("and the days it covers are contiguous, with no hole where a date was skipped", () => {
  const d = docDays(docTrip());
  d.forEach((iso, i) => { if (i) assert.equal(nightsBetween(d[i - 1], iso), 1); });
});
ok("the title reports the document span, so it cannot disagree with DAY 1", () => {
  const b = emitBlocks(docTrip());
  assert.equal(b[0].text, "Italy, October 2026");
  assert.equal(b[1].text, "(Saturday October 10 through Friday October 23)");
});
ok("day headings use her abbreviations, not the standard ones", () => {
  const heads = emitBlocks(docTrip()).filter((x) => x.kind === "day").map((x) => x.text);
  assert.equal(heads[0], "DAY 1 - SAT OCTOBER 10");
  assert.equal(heads[1], "DAY 2 - SUN OCTOBER 11");
  // TUES and THUR, not TUE and THU.
  assert.ok(heads.some((h) => h.includes("TUES OCTOBER 13")), heads.join(" | "));
  assert.ok(heads.some((h) => h.includes("THUR OCTOBER 15")), heads.join(" | "));
});
ok("an overnight flight departs on one day and arrives on the next", () => {
  const out = emitText(docTrip());
  const lines = out.split(String.fromCharCode(10));
  const dep = lines.findIndex((l) => l.includes("Depart ATL"));
  const arr = lines.findIndex((l) => l.includes("Arrive in"));
  assert.ok(dep > -1 && arr > dep, out);
  assert.ok(lines[dep].includes("4:35pm"), lines[dep]);
  // It lands in the city you sleep in, not the airport code.
  assert.ok(lines[arr].includes("Rome") && lines[arr].includes("7:35am"), lines[arr]);
});
ok("times are the doc's 12-hour, never 24", () => {
  const out = emitText(docTrip());
  assert.ok(!/\b1[3-9]:\d\d\b/.test(out), out);
  assert.ok(out.includes("9:05am"));
});
ok("the hotel is a nested block on the day you check in", () => {
  const lines = emitText(docTrip()).split(String.fromCharCode(10));
  const h = lines.find((l) => l.includes("Hotel:"));
  const a = lines.find((l) => l.includes("Address:"));
  const c = lines.find((l) => l.includes("Booking confirmation"));
  assert.equal(h, "   * Hotel: [Hotel Lancelot](https://www.lancelothotel.com/)");
  assert.equal(a, "   * Address: Via Capo D'Africa, 47, Roma");
  assert.equal(c, "   * Booking confirmation No.: 2026082251320670 (3 nights, October 11-14)");
});
ok("a day trip reads as the base city and the trip out of it", () => {
  const t = docTrip();
  t.days = { "2026-10-16": { notes: "", items: [], city: "Bologna", locked: false } };
  const out = emitText(t);
  assert.ok(out.includes("* Florence - Day trip to Bologna"), out);
});
ok("a short note becomes the day's theme; a long one keeps its own line", () => {
  const t = docTrip();
  t.days = {
    "2026-10-12": { notes: "Ancient Rome", items: [], city: "", locked: false },
    "2026-10-13": { notes: "A much longer note that is really a paragraph and not a theme at all", items: [], city: "", locked: false },
  };
  const out = emitText(t);
  assert.ok(out.includes("* Rome - Ancient Rome"), out);
  assert.ok(out.includes("* Rome" + String.fromCharCode(10)), "long-note day should keep a bare city line");
  assert.ok(out.includes("* A much longer note"), out);
});
ok("spacing is the doc's: one blank before DAY 1, two between days", () => {
  const out = emitText(docTrip());
  const lines = out.split(String.fromCharCode(10));
  const first = lines.indexOf("DAY 1 - SAT OCTOBER 10");
  assert.equal(lines[first - 1], "");
  assert.notEqual(lines[first - 2], "");
  const second = lines.indexOf("DAY 2 - SUN OCTOBER 11");
  assert.equal(lines[second - 1], "");
  assert.equal(lines[second - 2], "");
});
ok("an empty day is still a numbered heading - a missing day would read as a mistake", () => {
  const t = docTrip();
  const heads = emitBlocks(t).filter((x) => x.kind === "day");
  assert.equal(heads.length, 14);
  assert.ok(blankDays(t).length > 0);
});
ok("blankDays names the days nobody has planned", () => {
  const t = docTrip();
  const before = blankDays(t).length;
  t.days = { "2026-10-21": { notes: "Beach club?", items: [], city: "", locked: false } };
  assert.equal(blankDays(t).length, before - 1);
});
ok("markdown links are split out for rendering, text left intact", () => {
  const out = pieces("Hotel: [Hotel Lancelot](https://x.test/a) today");
  assert.deepEqual(out.map((x) => x.text), ["Hotel: ", "Hotel Lancelot", " today"]);
  assert.equal(out[1].url, "https://x.test/a");
  assert.deepEqual(pieces("no links here").map((x) => x.text), ["no links here"]);
});

/* The round trip. Emitting and parsing are two halves of the same claim about
   the format; if they disagree, one of them is wrong about her document. */
ok("what it writes, the parser reads back", () => {
  const t = docTrip();
  t.days = { "2026-10-12": { notes: "Ancient Rome", items: [], city: "", locked: false } };
  const parsed = parseDocText(emitText(t));

  assert.equal(parsed.name, "Italy, October 2026");
  assert.deepEqual(parsed.dates, { start: "2026-10-10", end: "2026-10-23" });
  const hotel = parsed.stays.find((x) => /Lancelot/.test(x.name));
  assert.ok(hotel, JSON.stringify(parsed.stays));
  assert.equal(hotel.url, "https://www.lancelothotel.com/");
  assert.equal(hotel.address, "Via Capo D'Africa, 47, Roma");
  assert.equal(hotel.ref, "2026082251320670");
  assert.ok(Object.keys(parsed.days).length > 0, "expected day headings to survive");
});
ok("and it reads back the hotel address it just wrote", () => {
  const parsed = parseDocText([
    "Italy, October 2026",
    "* Hotel: [Hotel Odeon](https://www.odeonhotelnapoli.it/)",
    "   * Address: Via Silvio Spaventa, 29, - 80142 Napoli",
  ].join(String.fromCharCode(10)));
  assert.equal(parsed.stays.length, 1);
  assert.equal(parsed.stays[0].address, "Via Silvio Spaventa, 29, - 80142 Napoli");
});

/* ------------------------------------------------------- nights under way */
/* Every night of a trip belongs to exactly one segment, and some of them are
   spent in a seat. Before segments were typed, the only way to satisfy that
   was to invent a city — so these are about the type carrying the meaning
   instead of a name having to imply it. */

console.log("\nnights under way");

/* Leaves on the 10th, lands on the 11th: the night of the 10th is in the air. */
const redeye = () => {
  const t = blankTrip("Italy");
  t.dates = { start: "2026-10-10", end: "2026-10-14", locked: true };
  t.flights.options = [{
    id: "o1", status: "Booked",
    out: { date: "2026-10-10", from: "ATL", to: "FCO", depart: "16:35", arrive: "07:35", plusOne: true },
    ret: { date: "2026-10-14", from: "FCO", to: "ATL", depart: "09:05", arrive: "14:39", plusOne: false },
  }];
  t.flights.bookedId = "o1";
  t.segments = [{ ...blankSegment("Rome", 3) }];
  return t;
};

ok("a night nobody has claimed is offered, and names the leg responsible", () => {
  const leg = transitGap(redeye());
  assert.ok(leg, "expected a gap");
  assert.equal(leg.date, "2026-10-10");
});
ok("accepting it puts the night at the front, as itself", () => {
  const t = addTransit(redeye());
  assert.equal(t.segments.length, 2);
  assert.equal(t.segments[0].kind, "transit");
  assert.equal(t.segments[0].city, "");
  assert.equal(t.segments[0].nights, 1);
  assert.equal(t.segments[1].city, "Rome");
});
ok("and then it stops being offered", () => {
  assert.equal(transitGap(addTransit(redeye())), null);
});
ok("accepting twice is not two nights in the air", () => {
  assert.equal(addTransit(addTransit(redeye())).segments.length, 2);
});
ok("nothing is offered when the flight lands the day it left", () => {
  const t = redeye();
  t.flights.options[0].out.plusOne = false;
  assert.equal(transitGap(t), null);
});
ok("the declared kind decides, without consulting the flights", () => {
  const t = blankTrip("X");
  t.dates = { start: "2026-10-10", end: "2026-10-14", locked: true };
  t.segments = [{ ...blankTransit(1) }, { ...blankSegment("Rome", 3) }];
  assert.equal(isTransitStop(t, t.segments[0]), true);
  assert.equal(isTransitStop(t, t.segments[1]), false);
});
ok("a one-night city under an overnight leg stays a city once it says so", () => {
  const t = redeye();
  // The shape the old inference calls transit. Undeclared, it is inferred as
  // one; declared a city, the declaration wins and the guess is not consulted.
  t.segments = [{ ...blankSegment("Reykjavik", 1) }, { ...blankSegment("Rome", 2) }];
  assert.equal(isTransitStop(t, t.segments[0]), true, "undeclared, the guess stands");
  t.segments[0].kind = "city";
  assert.equal(isTransitStop(t, t.segments[0]), false, "declared, the guess is overruled");
});
ok("a trip saved before segments were typed still reads correctly", () => {
  const t = redeye();
  // No `kind` at all, exactly as it sits in storage today.
  t.segments = [
    { id: "old1", city: "Overnight to Rome", nights: 1, locked: true },
    { id: "old2", city: "Rome", nights: 3, locked: true },
  ];
  assert.equal(isTransitStop(t, t.segments[0]), true);
  assert.equal(isTransitStop(t, t.segments[1]), false);
  assert.equal(transitGap(t), null, "it is already accounted for, so nothing is offered");
});
ok("hydrate must NOT stamp a kind onto a stored segment", () => {
  /* It spreads blankSegment over every saved segment, so a default there would
     rewrite every trip on load — turning the one-night stop under an overnight
     flight back into a city and silently undoing the whole point. */
  const h = hydrateTrip({ ...blankTrip("X"), segments: [{ id: "s1", city: "Rome", nights: 2 }] });
  assert.equal(h.segments[0].kind, undefined);
  assert.equal(h.segments[0].city, "Rome");
});
ok("a legacy transit stop survives a hydrate", () => {
  const t = redeye();
  t.segments = [
    { id: "old1", city: "Overnight to Rome", nights: 1, locked: true },
    { id: "old2", city: "Rome", nights: 3, locked: true },
  ];
  const h = hydrateTrip(t);
  assert.equal(isTransitStop(h, h.segments[0]), true);
  assert.equal(transitGap(h), null);
});
ok("a city the app creates says so, so it is never re-inferred", () => {
  assert.equal(addSegment([], "Rome", 3)[0].kind, "city");
  assert.equal(addSegment([{ ...blankSegment("Rome", 2) }], "Florence", 4)[1].kind, "city");
});
ok("a night in the air is never nagged for a city name", () => {
  const t = addTransit(redeye());
  assert.ok(!cityFlags(t).some((f) => /no city/i.test(f)), cityFlags(t).join(" | "));
  // A real city with no name still is.
  t.segments.push({ ...blankSegment("", 1) });
  assert.ok(cityFlags(t).some((f) => /no city/i.test(f)), cityFlags(t).join(" | "));
});
ok("it still owns its night, so the nights continue to add up", () => {
  const t = addTransit(redeye());
  assert.equal(assignedNights(t.segments), 4);
  assert.equal(tripNights(t), 4);
  const spans = segmentSpans(t);
  assert.equal(spans[0].startDate, "2026-10-10");
  assert.equal(spans[1].startDate, "2026-10-11");
  assert.equal(spans[1].seg.city, "Rome");
});
ok("and it wants no bed", () => {
  const t = addTransit(redeye());
  assert.equal(isTransitStop(t, t.segments[0]), true);
});

console.log(`\n${pass} checks passed\n`);
