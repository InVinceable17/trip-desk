/* ============================================================================
   parsers.js — turn scraped Google Flights text into data. Pure, testable.

   These replace the LLM round-trips in the original file. The scraped text is
   regular enough that regex is both sufficient and considerably more reliable
   than asking a model to read it.
   ========================================================================== */

import { to24h, blankLeg, blankOption, ISO, MON } from "./flights.js";

const TIME = /\b(\d{1,2}:\d{2}\s*[AP]M)\b/gi;
const MONEY = /\$\s?([\d,]+)/;
const clean = (s) => (s || "").replace(/ /g, " ").trim();

/* -------------------------------------------------------- 1. fare ladder */
/* Input: the innerText of Google's "Booking options" panel.

   Book with DeltaAirline        <- block header
   Hide options
   Delta Main Classic            <- brand
   $2,736                        <- price for ONE adult, whole trip
   Free seat selection           <- conditions, ignored
   ...
   Continue

   The same trip is routinely resold by codeshare partners (KLM here) as a
   single unbranded price. Those blocks carry no named fares, so preferring
   the block with the most fares picks the operating carrier automatically —
   and an explicit airline hint overrides that.                            */

const NOT_A_BRAND = /^(hide options|show options|continue|view options|book with|fare and baggage|prices include|selected)/i;

export function parseFareBlocks(text) {
  const t = clean(text).replace(/\r/g, "");
  const lines = t.split("\n").map(clean);
  const HEAD = /^Book with (.+?)(?:Airline)?$/i;

  const starts = [];
  lines.forEach((line, i) => { if (HEAD.test(line)) starts.push(i); });
  const blocks = starts.map((i) => ({ airline: clean(HEAD.exec(lines[i])[1]), fares: [] }));

  // Walk each block's line span and pair brand -> price.
  starts.forEach((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    const block = blocks[n];
    for (let i = start + 1; i < end - 1; i++) {
      const name = lines[i], next = lines[i + 1];
      if (!name || NOT_A_BRAND.test(name) || name.startsWith("$")) continue;
      if (name.length > 60) continue;
      const m = /^\$\s?([\d,]+)$/.exec(next);
      if (!m) continue;
      const each = +m[1].replace(/,/g, "");
      if (!each) continue;
      // "Delta Main Classic" -> "Main Classic"
      const brand = name.replace(new RegExp(`^${block.airline}\\s+`, "i"), "").trim();
      if (!brand) continue;
      block.fares.push({ name: brand, each });
      i++; // skip the price line
    }
  });

  return blocks.filter((b) => b.airline);
}

/** Pick the right airline's ladder out of the panel. */
export function parseFares(text, airline) {
  const blocks = parseFareBlocks(text);
  if (!blocks.length) return { fares: [], airline: "" };

  const want = clean(airline).toLowerCase();
  let pick = null;
  if (want) {
    pick = blocks.find((b) => {
      const a = b.airline.toLowerCase();
      return b.fares.length && (a.includes(want) || want.includes(a));
    });
  }
  if (!pick) {
    pick = blocks.reduce((best, b) => (b.fares.length > (best ? best.fares.length : 0) ? b : best), null);
  }
  if (!pick || !pick.fares.length) return { fares: [], airline: blocks[0].airline };
  return { fares: pick.fares, airline: pick.airline };
}

/* ------------------------------------------------------- 2. search rows */
/* Input: one result row's innerText, newline-separated.

   4:05 PM / – / 7:35 AM+1 / DeltaKLM / 9 hr 30 min / ATL–FCO / Nonstop /
   502 kg CO2e / -7% emissions / $1,441 / entire trip                      */

export function parseSearchRow(raw) {
  const t = clean(raw).replace(/\r/g, "");
  if (!t) return null;
  const lines = t.split("\n").map(clean).filter(Boolean);
  const joined = lines.join("\n");

  const times = joined.match(TIME);
  if (!times || times.length < 2) return null;

  const depart = to24h(times[0]);
  const arrive = to24h(times[1]);
  if (!depart || !arrive) return null;

  // "+1" is attached to the arrival time's line.
  const arrLine = lines.find((l) => l.toUpperCase().includes(times[1].toUpperCase())) || "";
  const plusOne = /\+\s?1/.test(arrLine);

  const durM = /(?:(\d+)\s*hr)?\s*(?:(\d+)\s*min)?/.exec(
    (joined.match(/\d+\s*hr(?:\s*\d+\s*min)?/) || [""])[0],
  );
  const hours = durM && durM[1] ? +durM[1] : 0;
  const mins = durM && durM[2] ? +durM[2] : 0;
  const dur = hours || mins ? `${hours}h ${String(mins).padStart(2, "0")}m` : "";

  const routeM = /\b([A-Z]{3})\s*[–—-]\s*([A-Z]{3})\b/.exec(joined);
  const from = routeM ? routeM[1] : "";
  const to = routeM ? routeM[2] : "";

  let stops = "";
  if (/\bNonstop\b/i.test(joined)) stops = "nonstop";
  else {
    const conns = [];
    const re = /\b\d+\s*(?:hr|min)[^\n]*?\b([A-Z]{3})\b/g;
    let m;
    while ((m = re.exec(joined))) if (m[1] !== from && m[1] !== to) conns.push(m[1]);
    const n = /(\d+)\s*stop/i.exec(joined);
    stops = conns.length ? [...new Set(conns)].join(", ") : n ? `${n[1]} stop` : "";
  }

  // Carrier sits between the arrival time and the duration.
  let carrier = "";
  const arrIdx = lines.findIndex((l) => l.toUpperCase().includes(times[1].toUpperCase()));
  for (let i = arrIdx + 1; i < lines.length; i++) {
    if (/\d+\s*hr|\d+\s*min/.test(lines[i])) break;
    if (/^[–—-]$/.test(lines[i])) continue;
    carrier = lines[i];
    break;
  }
  // "AmericanOperated by PSA Airlines as American Eagle" -> "American"
  carrier = carrier.replace(/Operated by.*$/i, "").trim();
  // "DeltaKLM" (marketing + operating) -> "Delta"
  const split = /^([A-Z][a-z]+(?: [A-Z][a-z]+)*)(?=[A-Z])/.exec(carrier);
  const carrierShort = split ? split[1] : carrier;

  const priceM = MONEY.exec(joined);
  const price = priceM ? +priceM[1].replace(/,/g, "") : null;

  return {
    depart, arrive, plusOne, dur, from, to, stops,
    carrier: carrierShort, carriersRaw: carrier, price,
    text: joined,
  };
}

export const parseSearchRows = (rows) =>
  (rows || []).map(parseSearchRow).filter(Boolean);

/* --------------------------------------------------- 3. flight numbers */
/* The expanded detail block ends with operating airline, cabin, aircraft and
   the flight number: "DeltaEconomyAirbus A330-900neoDL 214".              */

export function parseFlightNo(text, preferCode) {
  const t = clean(text);
  if (!t) return null;
  const out = [];
  // No leading \b: the flight number is often glued to the aircraft type, as
  // in "Airbus A330-900neoDL 214". The trailing guard rejects "CO2e".
  const re = /([A-Z]{2})\s?(\d{1,4})(?![\dA-Za-z])/g;
  let m;
  while ((m = re.exec(t))) out.push({ code: m[1], num: m[2] });
  if (!out.length) return null;
  if (preferCode) {
    const hit = out.filter((x) => x.code === preferCode.toUpperCase());
    if (hit.length) return hit[hit.length - 1];
  }
  return out[out.length - 1];
}

/* ------------------------------------------------------- 4. paste parser */
/* Best-effort plain-JS reading of pasted itinerary text. The original sent
   this to a model; without one, this handles the common shapes and says so
   plainly when it cannot. It always produces a draft for hand-correction. */

const MONTHS = MON.reduce((acc, m, i) => (m ? { ...acc, [m.toLowerCase()]: i } : acc), {});
const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/gi;

const toISO = (mon, day, year) =>
  `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function parsePaste(text, cfg) {
  const t = clean(text);
  const found = { dates: [], times: [], airports: [], flights: [], durs: [], prices: [] };
  if (!t) return { ok: false, why: "Nothing pasted.", draft: null, found };

  const defaultYear = ISO.test(cfg && cfg.windowStart) ? cfg.windowStart.slice(0, 4) : String(new Date().getFullYear());

  // dates — ISO first, then "Oct 10" / "October 10, 2026"
  let m;
  const isoRe = /\b(\d{4}-\d{2}-\d{2})\b/g;
  while ((m = isoRe.exec(t))) found.dates.push(m[1]);
  MONTH_RE.lastIndex = 0;
  while ((m = MONTH_RE.exec(t))) {
    found.dates.push(toISO(MONTHS[m[1].toLowerCase()], +m[2], m[3] || defaultYear));
  }
  found.dates = [...new Set(found.dates)];

  // times, keeping the "+1" that follows an arrival
  const timeRe = /\b(\d{1,2}:\d{2})\s*([AaPp])\.?[Mm]?\.?(\s*\+\s?1)?/g;
  while ((m = timeRe.exec(t))) {
    found.times.push({ t24: to24h(`${m[1]} ${m[2]}M`), plusOne: !!m[3] });
  }

  // airports — 3-letter uppercase runs that aren't common words
  const STOP = new Set(["THE", "AND", "FOR", "USD", "PM", "AM", "NON", "ONE", "TWO", "OUT", "VIA", "NEW"]);
  const apRe = /\b([A-Z]{3})\b/g;
  while ((m = apRe.exec(t))) if (!STOP.has(m[1])) found.airports.push(m[1]);

  const fnRe = /\b([A-Z]{2})\s?(\d{1,4})\b/g;
  while ((m = fnRe.exec(t))) found.flights.push(`${m[1]} ${m[2]}`);

  const durRe = /\b(\d{1,2})\s*(?:h|hr|hours?)\s*(\d{1,2})?\s*(?:m|min)?/gi;
  while ((m = durRe.exec(t))) found.durs.push(`${+m[1]}h ${String(m[2] ? +m[2] : 0).padStart(2, "0")}m`);

  const prRe = /\$\s?([\d,]+(?:\.\d{2})?)/g;
  while ((m = prRe.exec(t))) found.prices.push(+m[1].replace(/,/g, ""));

  const draft = blankOption();
  const put = (leg, i) => {
    const L = { ...blankLeg() };
    L.date = found.dates[i] || "";
    L.from = found.airports[i * 2] || "";
    L.to = found.airports[i * 2 + 1] || "";
    const dep = found.times[i * 2], arr = found.times[i * 2 + 1];
    L.depart = dep ? dep.t24 : "";
    L.arrive = arr ? arr.t24 : "";
    L.plusOne = arr ? arr.plusOne : i === 0;
    L.dur = found.durs[i] || "";
    L.flight = found.flights[i] || "";
    L.carrier = "";
    L.stops = /nonstop|non-stop|direct/i.test(t) ? "nonstop" : "";
    draft[leg] = L;
  };
  put("out", 0);
  put("ret", 1);

  if (found.prices.length) {
    const p = found.prices[0];
    const n = (cfg && +cfg.travelers) || 1;
    // A price near a "total"/"for 2" cue is divided; otherwise taken per person.
    draft.priceEach = String(/total|entire trip|for\s*2|both/i.test(t) && n > 1 ? Math.round(p / n) : p);
  }
  draft.name = [draft.out.from, draft.out.to].filter(Boolean).join(" → ") || "Pasted option";

  const gotOut = !!(draft.out.date && draft.out.from && draft.out.to);
  return {
    ok: gotOut,
    why: gotOut ? "" : "Couldn't find a date and two airports — fill the form in by hand.",
    draft,
    found,
  };
}
