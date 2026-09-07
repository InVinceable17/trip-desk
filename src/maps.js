/* ============================================================================
   maps.js — one click from a line in the plan to the place it means.

   Two URL shapes, both from Google's documented scheme, both of which hand
   off to the Maps app on a phone rather than opening the website:

     /maps/search/<query>                 one place
     /maps/dir/?api=1&origin=…&…          how to get there from the hotel

   Everything here is pure. The trip-aware helpers read model.js; model.js
   must never read this, or the import goes in a circle.
   ========================================================================== */

import { cityForDay, dayStay, leadStay } from "./model.js";

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

const sameCity = (a, b) => !!text(a) && text(a).toLowerCase() === text(b).toLowerCase();

/**
 * The hotel a day is run out of: the stay for the segment you *sleep* in that
 * night, which is not always the city the day is spent in. On a day trip to
 * Pompeii you still set out from the Rome hotel, and that is exactly the one
 * you want directions from. On the day you fly home there is no bed left, so
 * it falls back to the one you woke in.
 *
 * `leadStay` picks which stay counts — booked first, then the cheapest
 * shortlisted — the same answer the cost breakdown and the ribbon give, so
 * this cannot name a different hotel than the rest of the app does.
 */
export function dayBase(t, iso) {
  const st = dayStay(t, iso) || {};
  const seg = st.sleepSeg || st.wakeSeg;
  if (!seg) return null;
  const stay = leadStay(t, seg.id);
  if (!stay || (!text(stay.name) && !text(stay.address))) return null;
  return { seg, stay, query: placeQuery(stay.name, stay.address, seg.city) };
}

/**
 * Directions from that hotel to one thing on that day's list.
 *
 * Deliberately only ever two points. A route that strings the day's stops
 * together in the order they were typed assumes the order is a plan, and it
 * is not — it is the order somebody thought of them. What you actually want
 * standing in the lobby is how to get to the next thing.
 *
 * Walking when the stop is in the same city as the bed; otherwise no mode at
 * all, because the trip out to Pompeii is not a walk and Maps will choose one
 * you can change in a tap.
 */
export function itemRoute(t, iso, item) {
  if (!item || !text(item.title)) return null;
  const base = dayBase(t, iso);
  if (!base) return null;
  const city = dayCity(t, iso);
  return directions(
    [base.query, placeQuery(item.title, city)],
    sameCity(base.seg.city, city) ? "walking" : "",
  );
}
