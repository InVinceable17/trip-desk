/* ============================================================================
   model.js — what a trip is, and the arithmetic over it.

   Everything here is pure: no DOM, no network, no storage. The views read it,
   test.mjs exercises it.
   ========================================================================== */

import { ISO, toUTC, fromUTC, dayOf, range, blankLeg, blankOption, DEFAULT_CONFIG } from "./flights.js";

export const SCHEMA = 2;

export const PHASES = [
  { key: "dates",   label: "Dates",   n: 1 },
  { key: "flights", label: "Transport", n: 2 },
  { key: "cities",  label: "Cities",  n: 3 },
  { key: "stays",   label: "Stays",   n: 4 },
  { key: "days",    label: "Days",    n: 5 },
];
export const PHASE_KEYS = PHASES.map((p) => p.key);

export const STAY_STATUSES = ["Shortlist", "Maybe", "Ruled out", "Booked"];

/* Getting between places. Flights come from the Flights phase's chosen option;
   everything else is entered directly and lives in `trip.travel`. */
export const TRAVEL_KINDS = ["train", "ferry", "car", "bus", "transfer"];
export const KIND_GLYPH = {
  flight: "✈", train: "🚆", ferry: "⛴", car: "🚗", bus: "🚌", transfer: "→",
};
export const ITEM_KINDS = ["idea", "ticket", "reservation", "tip"];

/* Money. Every amount carries its own currency; the trip has a base it is all
   reported in, plus rates you keep yourself. Nothing here calls a rate API —
   a wrong rate you can see and edit beats a stale one fetched behind your back. */
export const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY"];
export const SYMBOL = { USD: "$", EUR: "€", GBP: "£", CHF: "CHF ", JPY: "¥" };
export const DEFAULT_RATES = { USD: 1, EUR: 1.08, GBP: 1.27, CHF: 1.12, JPY: 0.0065 };

export const fmtMoney = (amount, code = "USD") => {
  const n = Math.round(Number(amount) || 0);
  const sym = SYMBOL[code] || `${code} `;
  return `${sym}${n.toLocaleString()}`;
};

/* Segment colours. Distinct hues at similar lightness so no city reads as more
   important than another, and all of them hold up on both grounds. */
export const SEG_COLORS = [
  "#0E6E75", "#8A5A2B", "#4A5FA5", "#7A4470", "#3F7A4E", "#A5533F", "#4E6E8A", "#7A6A2E",
];
export const segColor = (i) => SEG_COLORS[i % SEG_COLORS.length];

const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ----------------------------------------------------------------- shapes */

/* A stretch of nights spent in one place. `kind` is the whole point of this
   being typed: every night of the trip belongs to exactly one segment, and
   some of those nights are spent in a seat rather than a bed. Before this
   existed the only way to satisfy that invariant was to invent a city called
   something like "Overnight to Rome" — a place that is not a place, which
   every reader then had to decode again. */
export const SEGMENT_KINDS = ["city", "transit"];

export const blankSegment = (city = "", nights = 1) => ({
  /* No `kind` here on purpose. hydrateTrip spreads blankSegment over every
     stored segment, so a default would stamp "city" onto trips saved before
     this existed — including the one-night stop under an overnight flight
     that is the whole reason for the type. Absent means "work it out", and
     the inference in isTransitStop is what works it out. A segment the app
     creates says what it is; see addSegment and blankTransit. */
  id: uid("seg"), city, nights: Math.max(1, nights), locked: false,
});

/** A night under way: no city, no bed, nothing to see. */
export const blankTransit = (nights = 1) => ({
  id: uid("seg"), city: "", nights: Math.max(1, nights), locked: false, kind: "transit",
});

export const blankTravel = (kind = "train") => ({
  id: uid("trv"), kind, date: "", from: "", to: "",
  depart: "", arrive: "", plusOne: false,
  carrier: "", ref: "", cost: "", currency: "USD", url: "", notes: "", booked: false,
});

/* `address` earns its place because the planning doc has one for every hotel,
   and a doc we cannot write back in full is only half a loop. Additive:
   hydrateTrip spreads over blankStay, so trips saved before this still open. */
export const blankStay = (segmentId = "") => ({
  id: uid("stay"), segmentId, name: "", url: "", total: "", currency: "USD",
  status: "Maybe", ref: "", notes: "", address: "", nightsOverride: null,
});

export const blankItem = (kind = "idea") => ({
  id: uid("it"), title: "", url: "", cost: "", currency: "USD", time: "", kind, done: false,
});

/* `city` is a day-trip override: where you spend the day when that is not the
   city you are sleeping in. Empty means "wherever the segment says". */
export const blankDay = () => ({ notes: "", items: [], city: "", locked: false });

/* ------------------------------------------------------------ doc source */
/* A trip may be a structured view of a Google Doc somebody else actually
   writes in. `text` is the doc exactly as it was last read; `fields` records
   what the doc said for each field we ingested, keyed by the same dotted path
   `fieldValue` reads. Keeping the doc's version separate from the trip's is
   the whole trick: it is what lets the app say "this diverged" instead of
   quietly overwriting one side with the other. */
export const blankSource = () => ({
  kind: "",           // "" | "gdoc"
  docUrl: "",
  docTitle: "",
  syncedAt: "",       // ISO of the last import
  syncedBy: "",       // display name, so a shared desk says who pulled it
  text: "",
  fields: {},         // { "stays.stay_x.name": "Hotel Artemide" }
});

export function blankTrip(name = "New trip") {
  const now = new Date().toISOString();
  return {
    schema: SCHEMA,
    id: uid("trip"),
    name,
    createdAt: now,
    updatedAt: now,
    travelers: 2,
    /* phase 1 */
    window: { start: "", end: "" },
    target: { minNights: 3, maxNights: 21 },
    dates: { start: "", end: "", locked: false },
    holidays: [],
    /* phase 2 */
    homeAirports: DEFAULT_CONFIG.homeAirports,
    destAirports: DEFAULT_CONFIG.destAirports,
    flights: {
      options: [], bookedId: null,
      booking: { ref: "", paidTotal: "", currency: "USD", url: "", notes: "" },
    },
    travel: [],
    baseCurrency: "USD",
    rates: { ...DEFAULT_RATES },
    /* phase 3 */
    segments: [],
    /* phase 4 */
    stays: [],
    /* phase 5 */
    days: {},
    /* provenance, when the trip is fed by a doc */
    source: blankSource(),
  };
}

/** Fill in anything a stored trip is missing, so old files keep opening. */
export function hydrateTrip(t) {
  const base = blankTrip();
  const f = t.flights || {};
  return {
    ...base, ...t,
    schema: SCHEMA,
    window: { ...base.window, ...(t.window || {}) },
    target: { ...base.target, ...(t.target || {}) },
    dates: { ...base.dates, ...(t.dates || {}) },
    holidays: Array.isArray(t.holidays) ? t.holidays : [],
    flights: {
      options: (f.options || []).map((o) => ({
        ...blankOption(), ...o,
        out: { ...blankLeg(), ...(o.out || {}) },
        ret: { ...blankLeg(), ...(o.ret || {}) },
      })),
      bookedId: f.bookedId || null,
      booking: { ref: "", paidTotal: "", currency: "USD", url: "", notes: "", ...(f.booking || {}) },
    },
    baseCurrency: t.baseCurrency || "USD",
    rates: { ...DEFAULT_RATES, ...(t.rates || {}) },
    travel: (t.travel || []).map((x) => ({ ...blankTravel(), ...x })),
    segments: (t.segments || []).map((s) => ({ ...blankSegment(), ...s })),
    stays: (t.stays || []).map((s) => ({ ...blankStay(), ...s })),
    days: t.days && typeof t.days === "object" ? t.days : {},
    source: { ...blankSource(), ...(t.source || {}),
      fields: (t.source && t.source.fields) || {} },
  };
}

/* ------------------------------------------------------------------ dates */

export const nightsBetween = (a, b) =>
  ISO.test(a || "") && ISO.test(b || "") ? Math.round((toUTC(b) - toUTC(a)) / 86400000) : 0;

/** Every date in the trip, arrival day through departure day inclusive. */
export const tripDays = (t) => range(t.dates.start, t.dates.end);

export const tripNights = (t) => nightsBetween(t.dates.start, t.dates.end);

const isWeekend = (iso) => dayOf(iso) === 0 || dayOf(iso) === 6;

/**
 * The PTO note. Weekdays in the range that aren't listed holidays — the days
 * you'd actually have to book off. Deliberately not a balance tracker.
 */
export function ptoNote(t) {
  const days = tripDays(t);
  const hol = new Set(t.holidays || []);
  const weekdays = days.filter((d) => !isWeekend(d) && !hol.has(d));
  const weekendDays = days.filter(isWeekend);
  const holidaysUsed = days.filter((d) => hol.has(d) && !isWeekend(d));
  return {
    total: days.length,
    nights: Math.max(0, days.length - 1),
    pto: weekdays.length,
    weekendDays: weekendDays.length,
    holidaysUsed: holidaysUsed.length,
  };
}

/* ----------------------------------------------------------------- travel */
/* One entry per actual movement, each on its own date — the outbound flight,
   the return flight, and any train or ferry between cities. The timeline draws
   these as discrete points, not one bar across the whole trip. */

export function travelLegs(t) {
  const out = [];
  const chosen = bookedFlight(t) || leadFlight(t);
  if (chosen) {
    const booked = chosen.id === t.flights.bookedId;
    [["out", chosen.out], ["ret", chosen.ret]].forEach(([which, L], legIdx) => {
      if (!L || !L.date) return;
      out.push({
        id: `${chosen.id}:${which}`,
        source: "flight", optionId: chosen.id, kind: "flight",
        date: L.date, from: L.from, to: L.to,
        depart: L.depart, arrive: L.arrive, plusOne: L.plusOne,
        carrier: L.carrier || chosen.bookVia, ref: L.flight,
        dur: L.dur, stops: L.stops,
        booked,
        name: chosen.name,
        // One fare covers both legs — hang it on the outbound so it is not
        // read twice when the legs are listed side by side.
        cost: legIdx === 0 && booked && t.flights.booking.paidTotal ? t.flights.booking.paidTotal : "",
        costCoversTrip: legIdx === 0 && booked && !!t.flights.booking.paidTotal,
        currency: t.flights.booking.currency || "USD",
        url: booked ? (t.flights.booking.url || chosen.url) : chosen.url,
        bookingRef: booked ? t.flights.booking.ref : "",
      });
    });
  }
  (t.travel || []).forEach((x) => {
    if (!x.date) return;
    out.push({ ...x, source: "travel", name: `${x.from || "?"} → ${x.to || "?"}` });
  });
  return out.sort((a, b) => (a.date + (a.depart || "")).localeCompare(b.date + (b.depart || "")));
}

/* --------------------------------------------------------------- segments */
/* Segments are an ordered list of {city, nights}. They lay onto the trip
   sequentially from the arrival date. A segment of N nights covers N days on
   the timeline; the departure day belongs to the last segment's city. */

export const assignedNights = (segments) =>
  (segments || []).reduce((n, s) => n + Math.max(0, +s.nights || 0), 0);

/**
 * Where each segment sits. `startIdx` is its first day's offset from arrival,
 * `nights` its width in day columns.
 */
export function segmentSpans(t) {
  const out = [];
  let idx = 0;
  const start = t.dates.start;
  (t.segments || []).forEach((s, i) => {
    const n = Math.max(0, +s.nights || 0);
    if (!n) return;
    out.push({
      seg: s, i, startIdx: idx, nights: n,
      startDate: ISO.test(start || "") ? fromUTC(toUTC(start) + idx * 86400000) : "",
      endDate: ISO.test(start || "") ? fromUTC(toUTC(start) + (idx + n) * 86400000) : "",
      color: segColor(i),
    });
    idx += n;
  });
  return out;
}

/**
 * A stop you sleep *on the way to* rather than *in* — one night, spanned end to
 * end by a leg that leaves the day it starts and lands the day it ends. An
 * overnight flight, a night train, a ferry. There is no bed to book for it, so
 * the Stays phase must not sit at "started" waiting for one.
 *
 * Derived rather than flagged, for the same reason `dayStay` is: a stored
 * boolean would have to be kept in step with the travel it describes, and the
 * travel already says it. `plusOne` is the whole tell — it is what "lands the
 * next day" means, and both flight legs and `trip.travel` carry it.
 *
 * A one-night city you fly into and out of is not this: that leg lands on the
 * day the stop begins, not the day it ends, so `plusOne` is false and you do
 * still need a bed.
 */
/**
 * Is this stretch time under way rather than a stay?
 *
 * The declared kind wins. The old inference is kept underneath it because
 * trips saved before segments were typed encode exactly this case as a
 * one-night "city" sitting under an overnight leg — reading them correctly
 * costs one condition and saves a migration that could only guess.
 */
export function isTransitStop(t, seg) {
  if (!seg) return false;
  if (seg.kind === "transit") return true;
  if (seg.kind === "city") return false;
  const span = segmentSpans(t).find((s) => s.seg.id === seg.id);
  if (!span || span.nights !== 1) return false;
  return travelLegs(t).some((L) => L.plusOne && L.date === span.startDate);
}

/**
 * A night the trip contains and nobody has accounted for: you take off on the
 * first day and land on the second, so that night is spent in the air, but no
 * segment says so. Returns the leg responsible, or null.
 *
 * Only the departure night is offered. An overnight leg in the middle of a
 * trip would have to split a stay in two, which is a different and much less
 * obvious edit — better left to the person than guessed at.
 */
export function transitGap(t) {
  const start = t.dates.start;
  if (!ISO.test(start || "")) return null;
  const leg = travelLegs(t).find((L) => L.plusOne && L.date === start);
  if (!leg) return null;
  const first = (t.segments || [])[0];
  if (first && isTransitStop(t, first)) return null;
  return leg;
}

/** Put the unaccounted night at the front, as itself. */
export function addTransit(t) {
  if (!transitGap(t)) return t;
  return { ...t, segments: [blankTransit(1), ...(t.segments || [])] };
}

/**
 * Where you wake and where you sleep on a given day. A stop of N nights that
 * arrives on day D has you sleeping there D..D+N-1 and waking there D+1..D+N —
 * so the day a new stop begins is a TRAVEL DAY: you wake in the old city and
 * go to sleep in the new one. The first and last days are travel days too.
 * All derived, never stored, so it can't drift from the plan.
 */
export function dayStay(t, iso) {
  const days = tripDays(t);
  const at = days.indexOf(iso);
  if (at < 0) return null;
  const spans = segmentSpans(t);
  if (!spans.length) return null;

  const holds = (s, i) => i >= s.startIdx && i < s.startIdx + s.nights;
  const sleepIn = spans.find((s) => holds(s, at)) || null;
  const wokeIn = at === 0 ? null : (spans.find((s) => holds(s, at - 1)) || null);

  const wake = wokeIn ? wokeIn.seg.city : "";
  const sleep = sleepIn ? sleepIn.seg.city : "";
  const arrival = at === 0;
  const departure = at === days.length - 1;

  return {
    idx: at, wake, sleep,
    wakeSeg: wokeIn ? wokeIn.seg : null,
    sleepSeg: sleepIn ? sleepIn.seg : null,
    color: (sleepIn || wokeIn || {}).color,
    arrival, departure,
    moves: !!wake && !!sleep && wake !== sleep,
    travelDay: (!!wake && !!sleep && wake !== sleep) || arrival || departure,
  };
}

/** Only the days where the city changes between waking and sleeping. */
export function travelDays(t) {
  return tripDays(t)
    .map((iso) => ({ iso, ...(dayStay(t, iso) || {}) }))
    .filter((d) => d.moves);
}

/** Any movement recorded on a given date. */
export const travelOn = (t, iso) => travelLegs(t).filter((L) => L.date === iso);

/**
 * Moves you have not arranged yet — the gap between "we're going to Florence on
 * the 14th" and "we have seats on a train".
 *
 * Every change of city needs its own way of getting there, with two things that
 * don't count: a move a flight already makes for you (the day you land, which
 * is a move from nowhere into your first city), and a leg that exists but is
 * still only a plan. An unbooked train is exactly the case this is for — the
 * date is decided and the seats are not.
 */
export function unplannedMoves(t) {
  const legs = travelLegs(t);
  const dayBefore = (iso) => (ISO.test(iso || "") ? fromUTC(toUTC(iso) - 86400000) : "");
  const flownInto = (iso) => legs.some((L) => L.kind === "flight"
    && (L.date === iso || (L.plusOne && L.date === dayBefore(iso))));
  const arranged = (iso) => (t.travel || []).some((x) => x.date === iso && x.booked);
  return travelDays(t).filter((d) => !flownInto(d.iso) && !arranged(d.iso));
}

/**
 * Where a given trip day is spent, and where you sleep that night — which are
 * not always the same place. A day trip changes the first and leaves the
 * second alone, so the hotel booked for the segment still applies.
 */
export function cityForDay(t, iso) {
  const days = tripDays(t);
  const at = days.indexOf(iso);
  if (at < 0) return null;
  const spans = segmentSpans(t);
  // The departure day has no night; it belongs to the last segment.
  const hit = spans.find((s) => at >= s.startIdx && at < s.startIdx + s.nights)
    || (spans.length && at === assignedNights(t.segments) ? spans[spans.length - 1] : null);
  if (!hit) return null;
  const base = hit.seg.city;
  const override = ((t.days || {})[iso] || {}).city || "";
  const dayTrip = !!override.trim() && override.trim().toLowerCase() !== (base || "").toLowerCase();
  return {
    city: dayTrip ? override.trim() : base,
    base,
    dayTrip,
    color: hit.color,
    segmentId: hit.seg.id,
  };
}

/** Every day whose location differs from the city it sleeps in. */
export function dayTrips(t) {
  return tripDays(t)
    .map((iso) => ({ iso, ...(cityForDay(t, iso) || {}) }))
    .filter((d) => d.dayTrip);
}

/** Set or clear a day trip. Clearing means "back to the city you sleep in". */
export function setDayTrip(t, iso, city) {
  const cur = (t.days || {})[iso] || blankDay();
  return { ...t, days: { ...(t.days || {}), [iso]: { ...cur, city: (city || "").trim() } } };
}

/**
 * The Cities page's combined list: homebase stops in order, each followed by
 * the day trips taken out of it. One list, two row types.
 */
export function cityPlan(t) {
  const spans = segmentSpans(t);
  const trips = dayTrips(t);
  const rows = [];
  spans.forEach((sp) => {
    rows.push({ type: "base", seg: sp.seg, i: sp.i, span: sp, color: sp.color });
    trips
      .filter((d) => d.segmentId === sp.seg.id)
      .forEach((d) => rows.push({ type: "trip", iso: d.iso, city: d.city, base: d.base, color: sp.color, seg: sp.seg }));
  });
  return rows;
}

/**
 * Move `delta` nights across the boundary after segment `i` — positive grows
 * segment i and shrinks i+1. Total nights are conserved, and no segment is
 * allowed below one night.
 */
export function moveBoundary(segments, i, delta) {
  const a = segments[i], b = segments[i + 1];
  if (!a || !b || !delta) return segments;
  // A locked city's dates are settled — neither side of the boundary moves.
  if (a.locked || b.locked) return segments;
  const max = (+b.nights || 0) - 1;      // b keeps at least 1
  const min = -((+a.nights || 0) - 1);   // a keeps at least 1
  const d = Math.max(min, Math.min(max, delta));
  if (!d) return segments;
  return segments.map((s, n) =>
    n === i ? { ...s, nights: (+s.nights || 0) + d }
      : n === i + 1 ? { ...s, nights: (+s.nights || 0) - d }
        : s);
}

/** Move a city to a new position in the order. */
export function moveSegment(segments, from, to) {
  if (from === to || from < 0 || to < 0 || from >= segments.length || to >= segments.length) return segments;
  const next = [...segments];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

export const citiesLocked = (t) =>
  (t.segments || []).length > 0 && (t.segments || []).every((s) => s.locked);

/**
 * Add a city. The first one takes the whole trip; later ones take whatever
 * nights are unassigned, and when nothing is spare they borrow a night from
 * the segment before them rather than pushing the trip over its length.
 */
export function addSegment(segments, city, totalNights) {
  const name = (city || "").trim();
  if (!name) return segments;
  if (!segments.length) return [{ ...blankSegment(name, Math.max(1, totalNights || 1)), kind: "city" }];

  const spare = (totalNights || 0) - assignedNights(segments);
  if (spare > 0) return [...segments, { ...blankSegment(name, spare), kind: "city" }];

  // Borrow from whichever stop has the most nights to spare — taking from the
  // last one runs out after a single city.
  let donor = -1, most = 1;
  segments.forEach((s, n) => { if ((+s.nights || 0) > most) { most = +s.nights; donor = n; } });
  if (donor >= 0) {
    return [
      ...segments.map((s, n) => (n === donor ? { ...s, nights: (+s.nights || 0) - 1 } : s)),
      { ...blankSegment(name, 1), kind: "city" },
    ];
  }
  return [...segments, { ...blankSegment(name, 1), kind: "city" }]; // every stop is down to one night; go over and flag it
}

/** Grow or shrink the last segment — the only edit that changes the total. */
export function resizeLast(segments, delta) {
  if (!segments.length || !delta) return segments;
  const i = segments.length - 1;
  if (segments[i].locked) return segments;
  const next = Math.max(1, (+segments[i].nights || 0) + delta);
  return segments.map((s, n) => (n === i ? { ...s, nights: next } : s));
}

/** What's wrong with the current city plan, in plain words. */
export function cityFlags(t) {
  const out = [];
  const total = tripNights(t);
  const got = assignedNights(t.segments);
  if (!t.dates.locked) out.push("Trip dates aren't locked yet — segments can't be placed reliably.");
  if (t.segments.length && total && got !== total) {
    out.push(got < total
      ? `${total - got} night${total - got === 1 ? "" : "s"} unassigned.`
      : `${got - total} night${got - total === 1 ? "" : "s"} more than the trip is long.`);
  }
  (t.segments || []).forEach((s) => {
    /* A night in the air has no city by definition; asking for one is noise. */
    if (!s.city.trim() && !isTransitStop(t, s)) out.push("A segment has no city yet.");
  });
  const open = (t.segments || []).filter((s) => !s.locked).length;
  if (t.segments.length && open) {
    out.push(`${open} of ${t.segments.length} cities still unlocked.`);
  }

  const booked = bookedFlight(t);
  if (booked && t.segments.length) {
    const first = t.segments[0], last = t.segments[t.segments.length - 1];
    if (booked.out.to && first.city && !cityMatches(first.city, booked.out.to)) {
      out.push(`You land at ${booked.out.to} but the first stop is ${first.city}.`);
    }
    if (booked.ret.from && last.city && !cityMatches(last.city, booked.ret.from)) {
      out.push(`You fly home from ${booked.ret.from} but the last stop is ${last.city}.`);
    }
  }
  return [...new Set(out)];
}

/* Airport codes aren't city names, so this is a hint, not a rule. A few
   well-known pairs plus a substring check keeps the flag from crying wolf. */
const AIRPORT_CITY = {
  FCO: "rome", CIA: "rome", MXP: "milan", LIN: "milan", BGY: "milan",
  VCE: "venice", TSF: "venice", NAP: "naples", FLR: "florence", PSA: "pisa",
  BLQ: "bologna", TRN: "turin", CTA: "catania", PMO: "palermo", BRI: "bari",
};
export function cityMatches(city, code) {
  const c = (city || "").trim().toLowerCase();
  if (!c) return true;
  const known = AIRPORT_CITY[(code || "").toUpperCase()];
  if (known) return c.includes(known) || known.includes(c);
  return true; // unknown airport — don't guess
}

/** A Google Maps search, for the "find hotels here" link on a stay. */
export const mapsSearch = (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}`;
export const hotelsIn = (city) => (city ? mapsSearch(`hotels in ${city}`) : null);

/* ------------------------------------------------------------------ money */

const num = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const bookedFlight = (t) =>
  (t.flights.options || []).find((o) => o.id === t.flights.bookedId) || null;

/** The flight option a cost estimate should use when nothing is booked. */
export const leadFlight = (t) => {
  const opts = (t.flights.options || []).filter((o) => o.status !== "Ruled out");
  const short = opts.filter((o) => o.status === "Shortlist");
  const pool = short.length ? short : opts;
  return pool.slice().sort((a, b) => (+a.priceEach || 1e9) - (+b.priceEach || 1e9))[0] || null;
};

/** The stay a cost estimate should use for one segment. */
export const leadStay = (t, segmentId) => {
  const pool = (t.stays || []).filter((s) => s.segmentId === segmentId && s.status !== "Ruled out");
  const booked = pool.find((s) => s.status === "Booked");
  if (booked) return booked;
  const short = pool.filter((s) => s.status === "Shortlist");
  const list = short.length ? short : pool;
  return list.slice().sort((a, b) => num(a.total) - num(b.total))[0] || null;
};

/** Convert an amount into the trip's base currency using the trip's own rates. */
export function toBase(t, amount, code) {
  const n = num(amount);
  if (!n) return 0;
  const rates = { ...DEFAULT_RATES, ...(t.rates || {}) };
  const base = t.baseCurrency || "USD";
  const inUsd = n * (rates[code || "USD"] != null ? rates[code || "USD"] : 1);
  const baseRate = rates[base] != null ? rates[base] : 1;
  return inUsd / baseRate;
}

/**
 * Every line that costs money, with what it is, what it costs in its own
 * currency, and whether that money is already spent. This is what the header
 * total opens into — a number you can't audit is a number you can't trust.
 */
export function costLines(t) {
  const lines = [];
  const travelers = Math.max(1, +t.travelers || 1);

  const bf = bookedFlight(t);
  if (bf) {
    const paid = num(t.flights.booking.paidTotal);
    lines.push({
      id: `flight:${bf.id}`, group: "Transport",
      label: bf.name || "Flights",
      detail: t.flights.booking.ref ? `conf. ${t.flights.booking.ref}` : `${bf.out.from}→${bf.out.to}`,
      amount: paid || num(bf.priceEach) * travelers,
      currency: paid ? (t.flights.booking.currency || "USD") : "USD",
      paid: !!paid,
    });
  } else {
    const lead = leadFlight(t);
    if (lead) lines.push({
      id: `flight:${lead.id}`, group: "Transport",
      label: lead.name || "Flights",
      detail: `${lead.status.toLowerCase()} · ${travelers} × ${fmtMoney(lead.priceEach, "USD")}`,
      amount: num(lead.priceEach) * travelers,
      currency: "USD",
      paid: false,
    });
  }

  (t.travel || []).forEach((x) => {
    if (!num(x.cost)) return;
    lines.push({
      id: `trv:${x.id}`, group: "Transport",
      label: `${x.kind} · ${x.from || "?"} → ${x.to || "?"}`,
      detail: x.ref || (x.date ? x.date : ""),
      amount: num(x.cost), currency: x.currency || "USD", paid: !!x.booked,
    });
  });

  (t.segments || []).forEach((seg) => {
    const s = leadStay(t, seg.id);
    if (!s || !num(s.total)) return;
    lines.push({
      id: `stay:${s.id}`, group: "Stays",
      label: `${seg.city || "unnamed"} — ${s.name || "unnamed"}`,
      detail: s.status === "Booked" ? (s.ref ? `conf. ${s.ref}` : "booked") : s.status.toLowerCase(),
      amount: num(s.total), currency: s.currency || "USD", paid: s.status === "Booked",
    });
  });

  Object.entries(t.days || {}).forEach(([iso, d]) => {
    ((d && d.items) || []).forEach((it) => {
      if (!num(it.cost)) return;
      lines.push({
        id: `item:${it.id}`, group: "Days",
        label: it.title || it.kind,
        detail: iso,
        amount: num(it.cost), currency: it.currency || "USD",
        paid: !!it.done && (it.kind === "ticket" || it.kind === "reservation"),
      });
    });
  });

  return lines.map((l) => ({ ...l, base: toBase(t, l.amount, l.currency) }));
}

/** The same lines rolled up: by group, by currency, and paid versus still due. */
export function costSummary(t) {
  const lines = costLines(t);
  const groups = {};
  const currencies = {};
  let paid = 0, due = 0;

  lines.forEach((l) => {
    groups[l.group] = groups[l.group] || { paid: 0, due: 0, n: 0 };
    groups[l.group][l.paid ? "paid" : "due"] += l.base;
    groups[l.group].n++;
    currencies[l.currency] = currencies[l.currency] || { paid: 0, due: 0 };
    currencies[l.currency][l.paid ? "paid" : "due"] += l.amount;
    if (l.paid) paid += l.base; else due += l.base;
  });

  return {
    lines, groups, currencies, paid, due,
    total: paid + due,
    base: t.baseCurrency || "USD",
    mixed: Object.keys(currencies).length > 1,
  };
}

/**
 * Trip cost. `estimated` is true wherever a line is a quote rather than money
 * already spent — the header says so rather than implying a firm number.
 */
export function tripCost(t) {
  const sum = costSummary(t);
  const by = (g) => (sum.groups[g] ? sum.groups[g].paid + sum.groups[g].due : 0);
  return {
    flights: by("Transport"),
    stays: by("Stays"),
    days: by("Days"),
    total: sum.total,
    paid: sum.paid,
    due: sum.due,
    base: sum.base,
    estimated: sum.due > 0 || sum.total === 0,
  };
}

/* ------------------------------------------------------- phase completion */

export function phaseState(t, key) {
  switch (key) {
    case "dates":
      return t.dates.locked ? "done" : (t.window.start || t.dates.start) ? "started" : "empty";
    case "flights": {
      // Getting there is not the same as getting around. A booked flight with
      // two unbooked trains under it is a trip you cannot actually take, so the
      // phase stays open until every move between cities is arranged too.
      if (!(t.flights.options || []).length && !(t.travel || []).length) return "empty";
      if (!t.flights.bookedId) return "started";
      return unplannedMoves(t).length ? "started" : "done";
    }
    case "cities": {
      const total = tripNights(t);
      if (!(t.segments || []).length) return "empty";
      // Nights adding up is not the same as having decided — a city counts
      // only once its dates are locked.
      const fits = !!total && assignedNights(t.segments) === total;
      return fits && citiesLocked(t) ? "done" : "started";
    }
    case "stays": {
      // A night in the air is still a night of the trip, but it is not a night
      // that wants a hotel — so a transit stop must not hold this phase open.
      const segs = (t.segments || []).filter((s) => !isTransitStop(t, s));
      if (!(t.stays || []).length) return "empty";
      const covered = segs.length && segs.every((s) =>
        (t.stays || []).some((x) => x.segmentId === s.id && x.status === "Booked"));
      return covered ? "done" : "started";
    }
    case "days": {
      const all = tripDays(t);
      const touched = all.filter((iso) => {
        const d = (t.days || {})[iso];
        return d && ((d.items || []).length || d.notes || d.city || d.locked);
      });
      if (!touched.length) return "empty";
      // A day counts as settled only once it is locked — a couple of filled-in
      // days is not a finished itinerary.
      return all.length && all.every((iso) => ((t.days || {})[iso] || {}).locked) ? "done" : "started";
    }
    default:
      return "empty";
  }
}

/** Everything still to be bought or reserved, across every day. */
export const daysLocked = (t) => {
  const all = tripDays(t);
  return all.length > 0 && all.every((iso) => ((t.days || {})[iso] || {}).locked);
};

export const lockedDayCount = (t) =>
  tripDays(t).filter((iso) => ((t.days || {})[iso] || {}).locked).length;

export function openBookings(t) {
  const out = [];
  Object.entries(t.days || {}).forEach(([iso, d]) => {
    ((d && d.items) || []).forEach((it) => {
      if (!it.done && (it.kind === "ticket" || it.kind === "reservation")) out.push({ ...it, date: iso });
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------ index entry */

export const indexEntry = (t) => ({
  id: t.id,
  name: t.name,
  dest: (t.segments || []).map((s) => s.city).filter(Boolean).slice(0, 3).join(" · ")
    || (t.destAirports || "").split(/[,\s]+/).filter(Boolean).slice(0, 3).join(" · "),
  start: t.dates.start || t.window.start || "",
  end: t.dates.end || t.window.end || "",
  locked: !!t.dates.locked,
  travelers: t.travelers,
  cost: tripCost(t).total,
  updatedAt: t.updatedAt,
});

/* -------------------------------------------------------------------- seed */
/* v1 shipped one hardcoded Italy trip that only reached storage if the user
   edited something. Re-seeding it here means an empty desk still opens onto
   the trip that was being planned, rather than nothing. Seeded once: the index
   records `seeded` so a deliberately emptied desk stays empty. */

export function seedTrips() {
  const t = blankTrip("Italy");
  t.id = "trip_italy_2026";
  t.travelers = 2;
  t.window = { start: "2026-10-10", end: "2026-10-25" };
  t.target = { minNights: 10, maxNights: 15 };
  // v1 called this the "time off" block. It is a plan, not a commitment, so it
  // arrives unlocked — phase 1 is where it gets confirmed.
  t.dates = { start: "2026-10-12", end: "2026-10-23", locked: false };
  t.homeAirports = "CVG, ATL, BNA, TYS, CHA";
  t.destAirports = "FCO, MXP, LIN, BGY, VCE, NAP, FLR, BLQ, PSA";
  t.flights.options = [{
    ...blankOption(),
    id: "opt_seed_dl_fco_nap",
    name: "Delta — into Rome, out of Naples",
    status: "Shortlist",
    bookVia: "Delta",
    fare: "Main Classic",
    priceEach: "2736",
    // Read off Google Flights' booking-options page on 22 Aug 2026.
    fares: [
      { name: "Main Classic", each: 2736 },
      { name: "Main Extra", each: 3086 },
      { name: "Comfort Classic", each: 3786 },
      { name: "Comfort Extra", each: 4366 },
    ],
    notes: "Fares read 22 Aug 2026. Basic economy wasn't offered on this pairing.",
    out: { date: "2026-10-10", from: "ATL", to: "FCO", depart: "16:05", arrive: "07:35", plusOne: true, stops: "nonstop", carrier: "Delta", flight: "DL 214", dur: "9h 30m" },
    ret: { date: "2026-10-23", from: "NAP", to: "ATL", depart: "09:05", arrive: "14:39", plusOne: false, stops: "nonstop", carrier: "Delta", flight: "DL 279", dur: "11h 34m" },
    checks: [{ at: "2026-08-22T15:00:00.000Z", each: 2736, fare: "Main Classic" }],
  }];
  return [hydrateTrip(t)];
}

/* --------------------------------------------------------------- migration */
/* v1 was one trip in `data/state.json` as {cfg, options}. */

export function migrateV1(state) {
  if (!state || typeof state !== "object") return null;
  const cfg = state.cfg || {};
  const t = blankTrip(cfg.tripName || "Imported trip");
  t.travelers = +cfg.travelers || 2;
  t.window = { start: cfg.windowStart || "", end: cfg.windowEnd || "" };
  t.homeAirports = cfg.homeAirports || DEFAULT_CONFIG.homeAirports;
  t.destAirports = cfg.destAirports || DEFAULT_CONFIG.destAirports;
  // v1's "time off" block is the closest thing it had to committed dates.
  if (ISO.test(cfg.blockStart || "") && ISO.test(cfg.blockEnd || "")) {
    t.dates = { start: cfg.blockStart, end: cfg.blockEnd, locked: false };
  }
  t.flights.options = Array.isArray(state.options) ? state.options : [];
  return hydrateTrip(t);
}
