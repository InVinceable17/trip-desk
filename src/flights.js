/* ============================================================================
   flights.js — pure logic. No DOM, no network. Unit-testable in node.
   Ported from the original flightoptions.jsx, unchanged except for exports.
   ========================================================================== */

/* ----------------------------------------------------------- date helpers */
export const DOW = ["S", "M", "T", "W", "T", "F", "S"];
export const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const toUTC = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
export const dayOf = (iso) => new Date(toUTC(iso)).getUTCDay();

export const label = (iso) => {
  if (!ISO.test(iso || "")) return "—";
  const [, m, d] = iso.split("-").map(Number);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOf(iso)]} ${MON[m]} ${d}`;
};

export const range = (a, b) => {
  const out = [];
  if (!ISO.test(a || "") || !ISO.test(b || "")) return out;
  for (let t = toUTC(a); t <= toUTC(b) && out.length < 40; t += 86400000) out.push(fromUTC(t));
  return out;
};

/* ------------------------------------------------------------- durations */
export const parseDur = (s) => {
  if (!s) return null;
  const h = /(\d+)\s*h/i.exec(s), m = /(\d+)\s*m/i.exec(s);
  if (!h && !m) return null;
  return (h ? +h[1] : 0) * 60 + (m ? +m[1] : 0);
};

export const showDur = (min) =>
  min == null ? "—" : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export const to12h = (t) => {
  if (!/^\d{2}:\d{2}$/.test(t || "")) return "";
  let [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
};

/** "4:05 PM" -> "16:05". Inverse of to12h. */
export const to24h = (s) => {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]?\.?\s*$/.exec(s || "");
  if (!m) return "";
  let h = +m[1] % 12;
  if (/[Pp]/.test(m[3])) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
};

/* --------------------------------------------- google flights url builder */
/* tfs is a small protobuf. Verified byte-identical against a URL Google
   itself produced, so we can build a live search from saved fields alone. */
const enc = (s) => Array.from(new TextEncoder().encode(s));

const b64url = (raw) => {
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(s) : Buffer.from(raw).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const legBytes = ({ date, from, to }) => {
  const b = [0x12, 0x0a, ...enc(date), 0x6a, 0x07, 0x08, 0x01, 0x12, 0x03, ...enc(from),
    0x72, 0x07, 0x08, 0x01, 0x12, 0x03, ...enc(to)];
  return [0x1a, b.length, ...b];
};

const TRAILER = [0x40, 0x01, 0x48, 0x01, 0x70, 0x01, 0x82, 0x01, 0x0b, 0x08,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x98, 0x01, 0x03];

export const legOk = (l) =>
  !!l && ISO.test(l.date || "") && /^[A-Z]{3}$/.test(l.from || "") && /^[A-Z]{3}$/.test(l.to || "");

const url = (raw) =>
  `https://www.google.com/travel/flights/search?tfs=${b64url(raw)}&hl=en&gl=US&curr=USD`;

/** Nothing chosen yet — the page that lists candidate outbound flights. */
export const searchUrl = (o) => {
  const legs = [o.out, o.ret].filter(legOk);
  if (!legs.length) return null;
  return url([0x08, 0x1c, 0x10, 0x02, ...legs.flatMap(legBytes), ...TRAILER]);
};

/* A leg with a known flight number encodes as a *chosen* flight, which lands
   straight on Google's booking-options page — where the fare brands live. */
export const flightParts = (l) => {
  const m = /\b([A-Z]{2})\s*(\d{1,4})\b/.exec(`${(l && l.flight) || ""} ${(l && l.carrier) || ""}`);
  return m ? { code: m[1], num: m[2] } : null;
};

const selLegBytes = (l, f) => {
  const inner = [0x0a, 0x03, ...enc(l.from), 0x12, 0x0a, ...enc(l.date), 0x1a, 0x03, ...enc(l.to),
    0x2a, f.code.length, ...enc(f.code), 0x32, f.num.length, ...enc(f.num)];
  const body = [0x12, 0x0a, ...enc(l.date), 0x22, inner.length, ...inner,
    0x6a, 0x07, 0x08, 0x01, 0x12, 0x03, ...enc(l.from), 0x72, 0x07, 0x08, 0x01, 0x12, 0x03, ...enc(l.to)];
  return [0x1a, body.length, ...body];
};

/** Leg 1 chosen, leg 2 still open. Lists return flights, so leg 2's flight
    number can be read here. */
export const partialUrl = (o, outParts) => {
  if (!legOk(o.out) || !legOk(o.ret) || !outParts) return null;
  return url([0x08, 0x1c, 0x10, 0x02, ...selLegBytes(o.out, outParts), ...legBytes(o.ret), ...TRAILER]);
};

/** Both legs chosen — the booking-options page, where the fare ladder lives. */
export const fareUrlFrom = (o, a, b) => {
  const legs = [[o.out, a], [o.ret, b]].filter(([l, p]) => legOk(l) && p);
  if (!legs.length) return null;
  return url([0x08, 0x1c, 0x10, 0x02, ...legs.flatMap(([l, p]) => selLegBytes(l, p)), ...TRAILER]);
};

export const fareUrl = (o) => {
  const legs = [o.out, o.ret].filter(legOk);
  if (!legs.length) return null;
  const parts = legs.map(flightParts);
  if (parts.some((p) => !p)) return null;
  return fareUrlFrom(
    o,
    legOk(o.out) ? flightParts(o.out) : null,
    legOk(o.ret) ? flightParts(o.ret) : null,
  );
};

/** A bare one-way / round-trip search from loose fields, for the picker. */
export const searchUrlFor = (out, ret) => {
  const legs = [out, ret].filter(legOk);
  if (!legs.length) return null;
  return url([0x08, 0x1c, 0x10, 0x02, ...legs.flatMap(legBytes), ...TRAILER]);
};

/* ---------------------------------------------------------------- shapes */
export const STATUSES = ["Shortlist", "Maybe", "Ruled out"];

export const blankLeg = () => ({
  date: "", from: "", to: "", depart: "", arrive: "",
  plusOne: true, stops: "", carrier: "", flight: "", dur: "",
});

export const blankOption = () => ({
  id: `opt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  name: "", status: "Maybe", priceEach: "", bookVia: "", url: "", notes: "",
  fare: "", fares: [],
  out: blankLeg(), ret: { ...blankLeg(), plusOne: false },
  checks: [], savedAt: new Date().toISOString(),
});

export const DEFAULT_CONFIG = {
  tripName: "Italy",
  windowStart: "2026-10-10", windowEnd: "2026-10-25",
  blockStart: "2026-10-12", blockEnd: "2026-10-23",
  travelers: 2,
  homeAirports: "CVG, ATL, BNA, TYS, CHA",
  destAirports: "FCO, MXP, LIN, BGY, VCE, NAP, FLR, BLQ, PSA",
};

export const SEED = [{
  ...blankOption(), id: "opt_seed_dl_fco_nap",
  name: "Delta — into Rome, out of Naples", status: "Maybe",
  priceEach: "1402", fare: "Main Classic", bookVia: "Delta",
  fares: [
    { name: "Main Basic", each: 1162 }, { name: "Main Classic", each: 1402 },
    { name: "Main Extra", each: 1602 }, { name: "Comfort Classic", each: 2452 },
    { name: "Comfort Extra", each: 2732 },
  ],
  notes: "Seed prices are from the original file and are almost certainly stale — run a price check.",
  out: { date: "2026-10-10", from: "ATL", to: "FCO", depart: "16:05", arrive: "07:35", plusOne: true, stops: "nonstop", carrier: "Delta", flight: "DL 214", dur: "9h 30m" },
  ret: { date: "2026-10-23", from: "NAP", to: "ATL", depart: "09:05", arrive: "14:39", plusOne: false, stops: "nonstop", carrier: "Delta", flight: "DL 279", dur: "11h 34m" },
  checks: [],
}];

/* ------------------------------------------------------------ validation */
export const flagsFor = (o, cfg, days) => {
  const f = [];
  const idx = (iso) => days.indexOf(iso);
  const wk = (d) => dayOf(d) === 0 || dayOf(d) === 6;
  if (o.out.date && idx(o.out.date) < 0) f.push("Outbound falls outside the window");
  if (o.ret.date && idx(o.ret.date) < 0) f.push("Return falls outside the window");
  if (o.out.date && cfg.blockStart && o.out.date < cfg.blockStart && !wk(o.out.date)) f.push("Outbound needs an extra day off");
  if (o.ret.date && cfg.blockEnd && o.ret.date > cfg.blockEnd && !wk(o.ret.date)) f.push("Return needs an extra day off");
  if (o.out.to && o.ret.from && o.out.to !== o.ret.from) f.push(`Open-jaw: in ${o.out.to}, out ${o.ret.from}`);
  return f;
};
