/* ============================================================================
   doc-parse.js — reading a trip out of a doc somebody wrote for humans.

   Deliberately conservative. A planning doc is prose, not a form, and a parser
   that guesses produces a trip that looks right and is quietly wrong — the
   worst outcome for something you will book flights against. So every line
   either matches a shape this understands or lands in `unparsed`, which the
   import panel shows you. Nothing is inferred from a line it did not
   recognise.

   Two ways in, and the second is the honest fallback for the first:

     parseDocText()   heuristics over the doc's own text
     parseDocJson()   the shape an LLM returns when handed importPrompt()

   Both produce the same object, which doc-sync.js folds into a trip. Pure
   module: no DOM, no network.
   ========================================================================== */

import { MON, ISO } from "./flights.js";
import { blankItem } from "./model.js";

const clean = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const stripBullet = (s) => clean(s).replace(/^[-–—•*·>•●▪]+\s*/, "").replace(/^\d+[.)]\s+/, "");

/* What is left after pulling a link or a price out of a line is the name plus
   whatever punctuation had been separating them. */
const trimSeps = (s) => clean(s).replace(/^[\s,;:–—-]+/, "").replace(/[\s,;:–—-]+$/, "");

const MONTHS = MON.reduce((m, name, i) => (i ? { ...m, [name.toLowerCase()]: i } : m), {});
const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const monthNum = (w) => MONTHS[clean(w).slice(0, 3).toLowerCase()] || 0;

/* Doc dates rarely carry a year. Anchoring to the trip's own window when there
   is one, and otherwise to the next occurrence, beats defaulting to this year
   and silently producing a trip that already happened. */
function resolveYear(month, day, anchor) {
  const base = anchor && ISO.test(anchor) ? new Date(`${anchor}T00:00:00Z`) : new Date();
  const y = base.getUTCFullYear();
  const cand = Date.UTC(y, month - 1, day);
  if (anchor) return y;
  return cand < base.getTime() - 86400000 * 30 ? y + 1 : y;
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** One date anywhere in a line: "Oct 12", "12 October", "2026-10-12", "10/12". */
export function parseOneDate(text, anchor) {
  const t = clean(text);
  const direct = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;

  let m = t.match(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, "i"));
  if (m) {
    const mo = monthNum(m[1]);
    return iso(m[3] ? Number(m[3]) : resolveYear(mo, Number(m[2]), anchor), mo, Number(m[2]));
  }
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\.?(?:,?\\s*(\\d{4}))?\\b`, "i"));
  if (m) {
    const mo = monthNum(m[2]);
    return iso(m[3] ? Number(m[3]) : resolveYear(mo, Number(m[1]), anchor), mo, Number(m[1]));
  }
  return "";
}

/**
 * A date range on one line. Handles "Oct 12 – Oct 23", "Oct 12-23",
 * "October 12 to October 23, 2026". Returns { start, end } or null.
 */
export function parseDateRange(text, anchor) {
  const t = clean(text);
  /* Symbols may sit flush against the dates; word separators must stand alone,
     or the "to" inside "October" splits the line in half. */
  const sep = "(?:\\s*(?:–|—|->|›|-)\\s*|\\s+(?:to|through|until)\\s+)";

  /* Same month, day range only on the right: "Oct 12–23". */
  let m = t.match(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${sep}(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, "i"));
  if (m && monthNum(m[1])) {
    const mo = monthNum(m[1]);
    const y = m[4] ? Number(m[4]) : resolveYear(mo, Number(m[2]), anchor);
    return { start: iso(y, mo, Number(m[2])), end: iso(y, mo, Number(m[3])) };
  }

  /* Two full dates. Split on the separator and read each side. */
  const halves = t.split(new RegExp(sep, "i"));
  if (halves.length === 2) {
    const start = parseOneDate(halves[0], anchor);
    const end = parseOneDate(halves[1], anchor || start);
    if (start && end && end >= start) return { start, end };
  }
  return null;
}

/* ------------------------------------------------------------- line shapes */

const URL_RE = /(https?:\/\/[^\s<>()\[\]]+)/i;
const MONEY_RE = /(?:[$€£]|USD|EUR|GBP)\s?([\d,]+(?:\.\d{2})?)/i;

/* "Rome (4 nights)", "Rome — 4 nights", "Rome: 4 nights", "4 nights in Rome" */
const CITY_NIGHTS = [
  /^(.+?)\s*[（(]\s*(\d{1,2})\s*(?:nights?|nts?|n)\s*[)）]\s*$/i,
  /^(.+?)\s*[–—:-]\s*(\d{1,2})\s*(?:nights?|nts?|n)\b.*$/i,
];
const NIGHTS_IN = /^(\d{1,2})\s*(?:nights?|nts?)\s+in\s+(.+?)\s*$/i;

/* "Hotel: Artemide", "Stay: ...", "Hotel Artemide — $1,200, conf ABC123" */
const HOTEL_LABEL = /^(?:hotel|stay|staying at|accommodation|lodging|airbnb)\s*[:–—-]\s*(.+)$/i;
/* Both sit under the hotel they belong to, so they attach to the last one
   seen. Without this the confirmation number a doc states on its own line is
   read as an unparsed stray, and the stay comes back with no booking on it. */
const ADDRESS_LABEL = /^address\s*[:–—-]\s*(.+)$/i;
const CONFIRM_LABEL = /^(?:booking\s+)?(?:confirmation|conf|booking)\s*(?:no\.?|number|code|#)?\s*[:–—-]\s*(.+)$/i;
/* Refs run to slashes as well as dashes: "2215/2026" is one in the wild. */
const REF_TOKEN = /^([A-Za-z0-9][A-Za-z0-9/-]{3,})/;
const REF_RE = /\b(?:conf(?:irmation)?|ref(?:erence)?|booking)\s*(?:#|no\.?|number|code)?\s*[:.]?\s*([A-Z0-9][A-Z0-9-]{4,})\b/i;

/* "Day 3 — Oct 14 — Florence", "Oct 14 (Wed)", "Wednesday, October 14" */
const DAY_HEAD = /^(?:day\s*\d+\s*[–—:-]?\s*)?(.*)$/i;

const isHeading = (line) => /^#{1,6}\s+/.test(line) || (line === line.toUpperCase() && /[A-Z]{3}/.test(line) && line.length < 60);
const dehead = (line) => clean(line.replace(/^#{1,6}\s+/, ""));

/**
 * Read a planning doc.
 *
 * `anchor` is an ISO date the doc's bare "Oct 12" should be resolved against —
 * pass the trip's existing start date so a doc written for next spring does not
 * quietly land in the past.
 *
 * Returns { name, dates, segments, stays, days, unparsed, text }. Every line
 * that carried no recognised shape is in `unparsed`, and the caller is expected
 * to show it rather than swallow it.
 */
export function parseDocText(text, { anchor = "", docUrl = "", docTitle = "" } = {}) {
  const raw = String(text || "").replace(/\r\n?/g, "\n");
  const lines = raw.split("\n");

  const out = {
    name: "", dates: null, travelers: 0,
    segments: [], stays: [], days: {},
    unparsed: [], text: raw, docUrl, docTitle,
  };

  let currentCity = "";
  let currentDay = "";
  let sawTitle = false;

  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (!line) { continue; }
    const body = stripBullet(dehead(line));
    if (!body) continue;

    /* The first substantial line is the doc's title, which is usually the
       trip's name — but only take it if it is not itself a date or a city. */
    if (!sawTitle) {
      sawTitle = true;
      if (!parseDateRange(body, anchor) && !CITY_NIGHTS.some((re) => re.test(body))) {
        out.name = body.replace(/\s*(?:trip|itinerary|plan(?:ning)?)\s*$/i, "").trim() || body;
        continue;
      }
    }

    /* Travellers: "2 travellers", "party of 3", "for 2 people" */
    const trav = body.match(/\b(?:party of\s+)?(\d{1,2})\s*(?:travell?ers?|people|adults|pax)\b/i)
      || body.match(/\bfor\s+(\d{1,2})\s+(?:of us|people)\b/i);
    if (trav) { out.travelers = Number(trav[1]); continue; }

    /* A trip-level date range, taken once — later ranges belong to segments. */
    const range = parseDateRange(body, anchor);
    if (range && !out.dates && !/\bnights?\b/i.test(body)) { out.dates = range; continue; }

    /* City with a night count. */
    let matched = false;
    for (const re of CITY_NIGHTS) {
      const m = body.match(re);
      if (m && !HOTEL_LABEL.test(body)) {
        const city = clean(m[1]).replace(/^\d+[.)]\s*/, "");
        if (city && city.length < 40 && !/^\d/.test(city)) {
          out.segments.push({ city, nights: Number(m[2]) });
          currentCity = city;
          matched = true;
        }
        break;
      }
    }
    if (matched) continue;

    const nIn = body.match(NIGHTS_IN);
    if (nIn) {
      const city = clean(nIn[2]);
      out.segments.push({ city, nights: Number(nIn[1]) });
      currentCity = city;
      continue;
    }

    /* Hotel, either labelled or sitting under a city heading with a link. */
    const hotel = body.match(HOTEL_LABEL);
    if (hotel) {
      const rest = clean(hotel[1]);
      const url = (rest.match(URL_RE) || [])[1] || "";
      const ref = (rest.match(REF_RE) || [])[1] || "";
      const total = (rest.match(MONEY_RE) || [])[1] || "";
      const name = trimSeps(rest.replace(URL_RE, "").replace(REF_RE, "").replace(MONEY_RE, ""));
      if (name || url) {
        out.stays.push({ name: name || url, url, ref, total: total.replace(/,/g, ""), city: currentCity, notes: "" });
        continue;
      }
    }

    const addr = body.match(ADDRESS_LABEL);
    if (addr && out.stays.length) {
      out.stays[out.stays.length - 1].address = trimSeps(addr[1]);
      continue;
    }

    const conf = body.match(CONFIRM_LABEL);
    if (conf && out.stays.length) {
      const tok = trimSeps(conf[1]).match(REF_TOKEN);
      if (tok) {
        out.stays[out.stays.length - 1].ref = tok[1];
        continue;
      }
    }

    /* A day heading: a bare date, optionally "Day 3 —" prefixed and optionally
       naming the city it is spent in. */
    const headBody = clean((body.match(DAY_HEAD) || [])[1] || body);
    const dayDate = parseOneDate(headBody, out.dates ? out.dates.start : anchor);
    if (dayDate && headBody.length < 60 && !MONEY_RE.test(headBody)) {
      currentDay = dayDate;
      if (!out.days[dayDate]) out.days[dayDate] = { notes: "", items: [] };
      const after = clean(headBody.split(new RegExp(`${MONTH_RE}\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?,?\\s*(?:\\d{4})?`, "i")).pop())
        .replace(/^[–—:,-]\s*/, "").replace(/^\(|\)$/g, "");
      if (after && after.length < 40 && !/^\d/.test(after)) out.days[dayDate].city = after;
      continue;
    }

    /* A bullet under a day is a plan for that day. Bullets elsewhere, and any
       line this did not recognise, are reported rather than guessed at. */
    const wasBullet = /^[-–—•*·•●▪]|\d+[.)]\s/.test(clean(rawLine));
    if (currentDay && wasBullet) {
      const url = (body.match(URL_RE) || [])[1] || "";
      const cost = (body.match(MONEY_RE) || [])[1] || "";
      const time = clean((body.match(/\b(\d{1,2}:\d{2}\s*(?:[ap]m)?)\b/i) || [])[1] || "");
      const title = trimSeps(body.replace(URL_RE, "").replace(MONEY_RE, ""));
      if (title) {
        out.days[currentDay].items.push({
          ...blankItem(/ticket|book|reserv/i.test(body) ? "reservation" : "idea"),
          title, url, cost: cost.replace(/,/g, ""), time,
        });
        continue;
      }
    }

    if (!isHeading(line)) out.unparsed.push(body);
  }

  /* A day with nothing in it carries no information. */
  for (const [k, v] of Object.entries(out.days)) {
    if (!v.notes && !(v.items || []).length && !v.city) delete out.days[k];
  }
  return out;
}

/* --------------------------------------------------------------- the LLM path */

/* Models fence their JSON more often than not, and the fence is the first
   thing on the line — so it has to come off before deciding what this is. */
const unfence = (text) => String(text || "").trim()
  .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/** Is this pasted text actually the JSON an LLM handed back? */
export const looksLikeJson = (text) => /^\s*[{[]/.test(unfence(text));

/**
 * Read the JSON shape importPrompt() asks for. Throws with something readable
 * when it is not that shape — a silent empty import is worse than an error.
 */
export function parseDocJson(text, { docUrl = "", docTitle = "" } = {}) {
  let data;
  try { data = JSON.parse(unfence(text)); } catch (e) {
    throw new Error(`That is not valid JSON — ${e.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Expected a JSON object.");

  const segments = (data.segments || data.cities || []).map((s) => ({
    city: clean(s.city || s.name), nights: Number(s.nights) || 0,
  })).filter((s) => s.city);

  const stays = (data.stays || data.hotels || []).map((s) => ({
    name: clean(s.name), url: clean(s.url), ref: clean(s.ref || s.confirmation),
    total: String(s.total || "").replace(/[^\d.]/g, ""), city: clean(s.city), notes: clean(s.notes),
    address: clean(s.address),
  })).filter((s) => s.name);

  const days = {};
  for (const [k, v] of Object.entries(data.days || {})) {
    if (!ISO.test(k)) continue;
    days[k] = {
      notes: clean(v.notes),
      city: clean(v.city),
      items: (v.items || []).map((i) => ({
        ...blankItem(i.kind || "idea"),
        title: clean(i.title), url: clean(i.url), time: clean(i.time),
        cost: String(i.cost || "").replace(/[^\d.]/g, ""),
      })).filter((i) => i.title),
    };
  }

  const dates = data.dates && data.dates.start
    ? { start: data.dates.start, end: data.dates.end || "" } : null;

  if (!data.name && !dates && !segments.length && !stays.length && !Object.keys(days).length) {
    throw new Error("Valid JSON, but nothing in it matched the trip shape.");
  }

  return {
    name: clean(data.name), dates, travelers: Number(data.travelers) || 0,
    segments, stays, days, unparsed: [],
    text: typeof data.text === "string" ? data.text : "",
    docUrl: data.docUrl || docUrl, docTitle: data.docTitle || docTitle,
  };
}

/** Whichever of the two the pasted text turns out to be. */
export function parseDoc(text, opts = {}) {
  return looksLikeJson(text) ? parseDocJson(text, opts) : parseDocText(text, opts);
}

/**
 * The prompt to hand an LLM along with the doc, when the doc is too prose-shaped
 * for the heuristics. Carries the trip's existing cities and hotels so the model
 * returns names that match what is already here instead of creating duplicates.
 */
export function importPrompt(trip) {
  const known = {
    cities: (trip.segments || []).map((s) => s.city).filter(Boolean),
    hotels: (trip.stays || []).map((s) => s.name).filter(Boolean),
  };
  return `Read the trip planning document below and return ONLY a JSON object — no prose, no code fence — in exactly this shape:

{
  "name": "trip name",
  "dates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "travelers": 2,
  "segments": [ { "city": "Rome", "nights": 4 } ],
  "stays":    [ { "name": "Hotel Artemide", "city": "Rome", "url": "", "ref": "", "total": "", "address": "", "notes": "" } ],
  "days": { "YYYY-MM-DD": { "city": "", "notes": "", "items": [ { "title": "", "time": "", "cost": "", "url": "", "kind": "idea" } ] } }
}

Rules:
- Omit any key the document does not actually state. Do not invent, estimate, or fill gaps.
- "segments" is the route in order, one entry per city slept in, with nights in that city.
- "kind" is one of: idea, ticket, reservation, tip.
- Costs are bare numbers, no currency symbols or commas.
- Dates must be full ISO. The trip starts ${trip.dates && trip.dates.start ? trip.dates.start : "on a date the document should state"} — resolve bare dates like "Oct 12" against that.
- Reuse these exact names where the document means the same thing, so nothing is duplicated:
  cities: ${known.cities.length ? known.cities.join(", ") : "(none yet)"}
  hotels: ${known.hotels.length ? known.hotels.join(", ") : "(none yet)"}

DOCUMENT:
`;
}
