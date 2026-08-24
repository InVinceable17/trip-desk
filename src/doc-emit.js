/* ============================================================================
   doc-emit.js — writing the trip back out in the planning doc's own format.

   The mirror of doc-parse.js. That module reads a doc a person wrote; this one
   produces a doc a person would recognise as theirs, from the trip as it now
   stands. Together they close the loop: the doc feeds the app, the app hands
   back something that pastes into the doc.

   The format is not invented here. It is copied from the doc this trip is
   actually planned in:

       Italy, October 2026
       (Saturday October 10 through Friday October 23)

       DAY 1 - SAT OCTOBER 10

       * Depart ATL at 4:35pm

   So: an uppercase DAY heading numbered from the first day, weekday and month
   uppercase, asterisk bullets at the top level and three-space-indented
   asterisks beneath. Hotels are a nested block on the day you check in.
   Links are markdown, because that is what survives a paste both ways.

   Every day of the trip gets a heading, including the ones with nothing on
   them — a gap in a numbered sequence reads as a mistake, and an empty day is
   information: it is a day nobody has planned yet.

   Pure: no DOM, no network. `blocks()` is the structure, `text()` is the
   string, and the view renders the former while the clipboard takes the
   latter — one description, two outputs, so they cannot drift.
   ========================================================================== */

import { dayOf, toUTC, fromUTC, range, ISO } from "./flights.js";
import {
  tripDays, segmentSpans, cityForDay, dayStay, travelOn, travelLegs, leadStay,
  nightsBetween, fmtMoney,
} from "./model.js";

/* Her abbreviations, not the standard ones: TUES and THUR, not TUE and THU.
   Matching the doc matters more than matching a convention. */
const DOW_DOC = ["SUN", "MON", "TUES", "WED", "THUR", "FRI", "SAT"];
const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_FULL = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const monthOf = (iso) => Number(iso.slice(5, 7));
const dayNum = (iso) => Number(iso.slice(8, 10));
const yearOf = (iso) => iso.slice(0, 4);

const mdLink = (label, url) => (url ? `[${label}](${url})` : label);

/** "Saturday October 10" — the long form, used in the range line only. */
const longDay = (iso) => `${DOW_FULL[dayOf(iso)]} ${MONTH_FULL[monthOf(iso)]} ${dayNum(iso)}`;

/** "SAT OCTOBER 10" — the heading form. */
const headDay = (iso) => `${DOW_DOC[dayOf(iso)]} ${MONTH_FULL[monthOf(iso)].toUpperCase()} ${dayNum(iso)}`;

/** "October 11-14", or "October 30-November 2" when it straddles a month. */
function spanPhrase(start, end) {
  const a = `${MONTH_FULL[monthOf(start)]} ${dayNum(start)}`;
  return monthOf(start) === monthOf(end)
    ? `${a}-${dayNum(end)}`
    : `${a}-${MONTH_FULL[monthOf(end)]} ${dayNum(end)}`;
}

/* 24h in, her 12h out: the doc says 4:35pm, never 16:35. */
export function to12h(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return (hhmm || "").trim();
  const h = Number(m[1]);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}${suffix}`;
}

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Where a flight puts you down, in words rather than airport codes. The doc
 * says "Arrive in Rome", not "Arrive in FCO".
 *
 * The question is where you *sleep* that night, not where you spend the day.
 * Ask the second and the flight home reads "Arrive in Naples at 2:39pm" — you
 * spent that morning in Naples, so the day belongs to it — when the plane in
 * fact lands in Atlanta. On a departure day you sleep nowhere the trip knows
 * about, which is exactly the signal to fall back to the airport code.
 */
function arrivalPlace(trip, leg, iso) {
  const st = dayStay(trip, iso);
  return (st && st.sleep) || leg.to || "";
}

/* --------------------------------------------------------------- the days */

/**
 * Which days the document covers — and it is not simply the trip's own dates.
 *
 * The outbound flight can leave the day before the trip "starts": `trip.dates`
 * is when you are *there*, and the doc counts DAY 1 from when you leave. Emit
 * only tripDays and that departure has no day to sit on and vanishes, which
 * for a document you book against is the worst possible failure.
 *
 * So: span from the earliest thing that happens to the latest, and fill every
 * date in between. Contiguous, because a numbered sequence with a hole in it
 * reads as a mistake rather than as a day with nothing planned.
 */
export function docDays(trip) {
  const marks = [...tripDays(trip)];
  travelLegs(trip).forEach((L) => {
    if (!ISO.test(L.date || "")) return;
    marks.push(L.date);
    if (L.plusOne) marks.push(fromUTC(toUTC(L.date) + 86400000));
  });
  if (!marks.length) return [];
  const sorted = [...new Set(marks)].sort();
  return range(sorted[0], sorted[sorted.length - 1]);
}

/** Movement on a day, split across days the way an overnight flight really is. */
function travelLines(trip, iso, prevIso) {
  const out = [];

  travelOn(trip, iso).forEach((L) => {
    if (L.kind === "flight") {
      const at = L.depart ? ` at ${to12h(L.depart)}` : "";
      out.push(`Depart ${L.from}${at}`);
      /* A same-day flight lands on the day it left; a +1 lands tomorrow, and
         is emitted there instead — see the prevIso pass below. */
      if (!L.plusOne && L.arrive) out.push(`Arrive in ${arrivalPlace(trip, L, iso)} at ${to12h(L.arrive)}`);
    } else {
      const mode = { train: "Train", ferry: "Ferry", car: "Drive", bus: "Bus", transfer: "Transfer" }[L.kind] || "Travel";
      const at = L.depart ? ` at ${to12h(L.depart)}` : "";
      out.push(`${mode} to ${L.to || arrivalPlace(trip, L, iso)}${at}`);
    }
  });

  /* Yesterday's red-eye arrives today. */
  if (prevIso) {
    travelOn(trip, prevIso).forEach((L) => {
      if (L.kind === "flight" && L.plusOne && L.arrive) {
        out.push(`Arrive in ${arrivalPlace(trip, L, iso)} at ${to12h(L.arrive)}`);
      }
    });
  }

  return out;
}

/**
 * The one-line "where you are" bullet: "Rome", "Florence - Day trip to Bologna".
 *
 * It names the city you sleep in, which is why the day you fly home has no such
 * line at all — you are not staying anywhere, and "* Naples" under a bullet
 * that says you left Naples at 9:05am is just wrong.
 */
function placeLine(trip, iso, notesHead) {
  const st = dayStay(trip, iso);
  const base = (st && st.sleep) || "";
  if (!base) return "";

  const where = cityForDay(trip, iso);
  const out = where && where.city && where.city !== base ? `Day trip to ${where.city}` : "";
  /* A short single-line note reads as the day's theme and belongs on the same
     line — "Rome - Ancient Rome". Anything longer stands on its own. */
  const tail = out || notesHead;
  if (!tail) return base;
  /* The city is prefixed even when the note repeats it — "Florence -
     Renaissance Day in Florence" is clumsy, but the doc's own dominant form is
     "Rome - Ancient Rome", and dropping the prefix whenever the note happened
     to contain the city name would silently strip it from that one too. A
     consistent line beats a clever one. */
  return `${base} - ${tail}`;
}

/** The nested hotel block, on the day you check in. */
function hotelBlock(trip, iso) {
  const span = segmentSpans(trip).find((s) => s.startDate === iso);
  if (!span) return [];
  const stay = leadStay(trip, span.seg.id);
  if (!stay || !stay.name) return [];

  const out = [{ depth: 1, text: `Hotel: ${mdLink(stay.name, stay.url)}` }];
  if (stay.address) out.push({ depth: 1, text: `Address: ${stay.address}` });
  if (stay.ref) {
    const nights = nightsBetween(span.startDate, span.endDate);
    out.push({
      depth: 1,
      text: `Booking confirmation No.: ${stay.ref} (${plural(nights, "night")}, ${spanPhrase(span.startDate, span.endDate)})`,
    });
  }
  (stay.notes || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .forEach((n) => out.push({ depth: 1, text: n }));
  return out;
}

/** A day's own items, as bullets: "8:30AM Entry into Academia Gallery". */
function itemLines(day) {
  return (day.items || [])
    .filter((it) => (it.title || "").trim() || it.url)
    .map((it) => {
      const bits = [];
      if (it.time) bits.push(to12h(it.time));
      bits.push(it.url && it.title ? mdLink(it.title, it.url) : (it.title || it.url));
      const line = bits.join(" ");
      /* The doc writes money with its symbol — "($73)", not "(73)". */
      return it.cost ? `${line} (${fmtMoney(it.cost, it.currency)})` : line;
    });
}

/* ------------------------------------------------------------------ blocks */

/**
 * The itinerary as a list of blocks. `kind` is "title" | "range" | "day" |
 * "bullet"; bullets carry a `depth` of 0 or 1. The view renders these; text()
 * serialises them. Deriving both from one description is the point — a
 * preview that disagrees with what you paste is worse than no preview.
 */
export function blocks(trip) {
  const days = docDays(trip);
  const out = [];

  /* The heading reports the document's own span, which is the span of the days
     below it — not trip.dates, or the title would disagree with DAY 1. */
  const start = days[0] || trip.dates.start;
  const end = days[days.length - 1] || trip.dates.end;
  const name = (trip.name || "Trip").trim();

  if (start && end) {
    const months = monthOf(start) === monthOf(end)
      ? MONTH_FULL[monthOf(start)]
      : `${MONTH_FULL[monthOf(start)]}-${MONTH_FULL[monthOf(end)]}`;
    out.push({ kind: "title", text: `${name}, ${months} ${yearOf(start)}` });
    out.push({ kind: "range", text: `(${longDay(start)} through ${longDay(end)})` });
  } else {
    out.push({ kind: "title", text: name });
  }

  days.forEach((iso, i) => {
    out.push({ kind: "day", text: `DAY ${i + 1} - ${headDay(iso)}`, iso });

    const day = (trip.days || {})[iso] || {};
    const noteLines = (day.notes || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    /* One short line is the day's theme and rides on the place bullet; more
       than that is prose and gets its own bullets. */
    const where = cityForDay(trip, iso);
    const foldable = noteLines.length === 1 && noteLines[0].length <= 40
      && !(where && where.city && where.city !== where.base);
    const head = foldable ? noteLines[0] : "";

    travelLines(trip, iso, i > 0 ? days[i - 1] : "").forEach((t) => out.push({ kind: "bullet", depth: 0, text: t }));

    const place = placeLine(trip, iso, head);
    if (place) out.push({ kind: "bullet", depth: 0, text: place });

    hotelBlock(trip, iso).forEach((b) => out.push({ kind: "bullet", ...b }));

    if (!foldable) noteLines.forEach((n) => out.push({ kind: "bullet", depth: 0, text: n }));
    itemLines(day).forEach((t) => out.push({ kind: "bullet", depth: 0, text: t }));
  });

  return out;
}

/**
 * The blocks as the plain text that goes on the clipboard. The spacing is the
 * doc's own: one blank line before DAY 1, two between days, and one under a
 * heading only when something actually follows it.
 */
export function text(trip) {
  const bs = blocks(trip);
  const lines = [];
  let seenDay = false;
  bs.forEach((b, i) => {
    if (b.kind === "title" || b.kind === "range") { lines.push(b.text); return; }
    if (b.kind === "day") {
      lines.push("");
      if (seenDay) lines.push("");
      seenDay = true;
      lines.push(b.text);
      const next = bs[i + 1];
      if (next && next.kind === "bullet") lines.push("");
      return;
    }
    lines.push(`${b.depth ? "   " : ""}* ${b.text}`);
  });
  return `${lines.join(String.fromCharCode(10))}${String.fromCharCode(10)}`;
}

/** Split a line into text and markdown links, so a view can render anchors. */
export function pieces(line) {
  const out = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let at = 0;
  let m = re.exec(line);
  while (m) {
    if (m.index > at) out.push({ text: line.slice(at, m.index) });
    out.push({ text: m[1], url: m[2] });
    at = m.index + m[0].length;
    m = re.exec(line);
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out.length ? out : [{ text: line }];
}

/**
 * Days the document covers but has nothing to say about yet.
 *
 * Not "days with no bullets" — every day inside a segment gets an automatic
 * city line, so by that measure nothing is ever empty. A day is unplanned when
 * the only thing under it is that derived line: no notes, no items, no
 * movement, no hotel to check into. That is precisely the "* Florence" day in
 * the real doc, and it is the thing worth counting.
 */
export function blankDays(trip) {
  const starts = new Set(segmentSpans(trip).map((s) => s.startDate));
  return docDays(trip).filter((iso) => {
    const day = (trip.days || {})[iso] || {};
    if ((day.notes || "").trim()) return false;
    if ((day.items || []).length) return false;
    if (day.city) return false;
    if (travelOn(trip, iso).length) return false;
    if (starts.has(iso)) return false;
    return true;
  });
}

export const _internals = { headDay, longDay, spanPhrase, to12h, toUTC };
