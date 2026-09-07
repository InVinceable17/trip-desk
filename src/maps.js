/* ============================================================================
   maps.js — one click from a line in the plan to the place it means.

   Two URL shapes, both from Google's documented scheme, both of which hand
   off to the Maps app on a phone rather than opening the website:

     /maps/search/<query>                 one place
     /maps/dir/?api=1&origin=…&…          a route through several

   Everything here is pure. The trip-aware helpers read model.js; model.js
   must never read this, or the import goes in a circle.
   ========================================================================== */

import { cityForDay, dayStay, cityStops } from "./model.js";

const BASE = "https://www.google.com/maps";

/* ------------------------------------------------------------------ places */

/** A Google Maps search for a free-text place. */
export const mapsSearch = (q) => `${BASE}/search/${encodeURIComponent(q)}`;
export const hotelsIn = (city) => (city ? mapsSearch(`hotels in ${city}`) : null);

/**
 * A name plus whatever it takes to find it. "Duomo" matches a dozen churches;
 * "Duomo, Florence" matches one — so every query built here carries the city
 * the thing is in, and the address when we know it.
 *
 * Parts that repeat something already said are dropped: a hotel address
 * usually names its own city, and an item titled after the city it is in
 * would otherwise search for "Capri, Capri".
 */
export function placeQuery(...parts) {
  const out = [];
  for (const p of parts) {
    const s = String(p == null ? "" : p).trim().replace(/\s+/g, " ");
    if (!s) continue;
    const low = s.toLowerCase();
    if (out.some((o) => o.toLowerCase().includes(low))) continue;
    out.push(s);
  }
  return out.join(", ");
}

/** The link for a place, or null when there is nothing to point at. */
export function placeUrl(...parts) {
  const q = placeQuery(...parts);
  return q ? mapsSearch(q) : null;
}

/**
 * Is this link already a Google Maps link?
 *
 * It matters because a pasted link beats anything we can build: a
 * `maps.app.goo.gl` short link is the exact pin somebody stood on and saved,
 * and a search for the title is only ever a guess at it. Where a saved link
 * exists, the pin opens that.
 */
const MAPS_URL = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;
export const isMapsUrl = (u) => MAPS_URL.test(String(u || "").trim());

/* ------------------------------------------------------------------ routes */

/**
 * Google's URL API takes an origin, a destination and at most nine waypoints.
 * Hand it a tenth and it does not complain — it drops it, and a day that
 * looks routed is quietly missing a stop. So trim here, and say how many.
 */
export const MAX_WAYPOINTS = 9;

/**
 * A route through a list of place queries. Fewer than two is not a route —
 * the pin on the thing itself already says where it is — so that returns null
 * rather than a link to nowhere.
 */
export function directions(stops, mode = "") {
  const list = (stops || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (list.length < 2) return null;
  const mid = list.slice(1, -1);
  const kept = mid.slice(0, MAX_WAYPOINTS);
  /* Built by hand rather than with URLSearchParams, which spells a space as
     "+". Google reads that, but every other link in the app spells it %20 and
     a URL you may paste anywhere should not depend on the reader's leniency. */
  const q = [
    "api=1",
    `origin=${encodeURIComponent(list[0])}`,
    `destination=${encodeURIComponent(list[list.length - 1])}`,
    kept.length ? `waypoints=${kept.map(encodeURIComponent).join("%7C")}` : "",
    mode ? `travelmode=${mode}` : "",
  ].filter(Boolean).join("&");
  return { url: `${BASE}/dir/?${q}`, stops: list, dropped: mid.length - kept.length };
}

/* ------------------------------------------------------------- trip things */

const text = (v) => String(v == null ? "" : v).trim();
const dayCity = (t, iso) => ((cityForDay(t, iso) || {}).city || "");

/**
 * The place a day's item points at. A link already pasted in wins; otherwise
 * the title, in the city that day is spent in. An item with no title is not a
 * place yet, and gets no pin.
 */
export function itemUrl(t, iso, item) {
  if (!item) return null;
  if (isMapsUrl(item.url)) return text(item.url);
  if (!text(item.title)) return null;
  return placeUrl(item.title, dayCity(t, iso));
}

/** The place a stay is. The address is the whole reason it is stored. */
export function stayUrl(t, stay) {
  if (!stay) return null;
  if (isMapsUrl(stay.url)) return text(stay.url);
  if (!text(stay.name) && !text(stay.address)) return null;
  const seg = (t.segments || []).find((s) => s.id === stay.segmentId);
  return placeUrl(stay.name, stay.address, seg ? seg.city : "");
}

/* An airport code is not a place name and a city name is not a station. What
   kind of leg it is says which word we are holding, so the query can say so
   too — "Naples" alone lands you in the middle of Naples, not at Centrale. */
const ENDPOINT = { flight: "airport", train: "train station", ferry: "ferry terminal", bus: "bus station" };

const endpoint = (kind, where) => {
  const w = text(where);
  if (!w) return "";
  const hint = ENDPOINT[kind];
  return hint && !w.toLowerCase().includes(hint) ? `${w} ${hint}` : w;
};

/** Where a leg starts or ends, as a place. `which` is "from" or "to". */
export function legPlaceUrl(leg, which) {
  const q = endpoint((leg || {}).kind, (leg || {})[which]);
  return q ? mapsSearch(q) : null;
}

const LEG_MODE = { train: "transit", bus: "transit", ferry: "transit", car: "driving", transfer: "driving" };

/**
 * Getting from one end of a leg to the other. A flight gets none: nobody needs
 * turn-by-turn from Atlanta to Rome, and Maps will cheerfully offer it.
 */
export function legRoute(leg) {
  if (!leg || leg.kind === "flight") return null;
  return directions(
    [endpoint(leg.kind, leg.from), endpoint(leg.kind, leg.to)],
    LEG_MODE[leg.kind] || "",
  );
}

const sameCity = (a, b) => !!text(a) && text(a).toLowerCase() === text(b).toLowerCase();

/**
 * The stops of one day, in the order they are written down.
 *
 * It starts at the hotel, under two conditions. The bed has to be booked — an
 * origin you have not committed to is a guess about where you will be standing
 * that morning, and a wrong origin bends the whole route. And it has to be in
 * the city the day is spent in: on the day you move to Florence you wake in
 * Rome, and a walk from last night's hotel to today's first stop is a walk of
 * 270km. No origin at all just starts you at the first thing on the list,
 * which is honest. The same rule quietly drops the hotel on a day trip, for
 * the same reason.
 */
export function dayStops(t, iso) {
  const city = dayCity(t, iso);
  const out = [];
  const st = dayStay(t, iso) || {};
  const seg = [st.sleepSeg, st.wakeSeg].find((x) => x && sameCity(x.city, city));
  const bed = seg && (t.stays || []).find((s) => s.segmentId === seg.id && s.status === "Booked");
  if (bed) out.push(placeQuery(bed.name, bed.address, seg.city));
  (((t.days || {})[iso] || {}).items || []).forEach((it) => {
    if (text(it.title)) out.push(placeQuery(it.title, city));
  });
  return out.filter(Boolean);
}

/**
 * The day on foot. Walking, because these are stops inside one city — getting
 * to another city is a leg in Transport, and that carries its own mode.
 */
export const dayRoute = (t, iso) => directions(dayStops(t, iso), "walking");

/**
 * The whole trip as one route: the cities, in order. A night in the air is
 * not a stop on a map — the plane's path is not the drive — and two nights in
 * one city are one stop, not two. No travel mode: which of a train and a car
 * this is varies leg by leg, and Maps will pick one you can change in a tap.
 */
export function tripRoute(t) {
  const cities = cityStops(t).map((s) => text(s.city)).filter(Boolean);
  const stops = cities.filter((c, i) => i === 0 || c.toLowerCase() !== cities[i - 1].toLowerCase());
  return directions(stops);
}
