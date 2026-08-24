/* ============================================================================
   doc-sync.js — reconciling a trip with the doc it came from.

   The doc is the source of truth for the people writing it; the trip is a
   structured view that has to survive both sides being edited. So an import
   never blindly overwrites. It records what the doc said (trip.source.fields)
   alongside what the trip holds, and anywhere those two disagree the app can
   say so rather than picking a winner behind your back.

   Three states for any field the doc has an opinion about:

     clean     trip value === what the doc said last import
     drifted   trip value changed here since that import
     incoming  doc value changed there since that import

   Both changed is still "drifted" — you look at it and choose. Pure module:
   no DOM, no network. test.mjs exercises it.
   ========================================================================== */

import { blankSegment, blankStay, blankSource } from "./model.js";

/* Fields worth tracking. Anything not listed is the app's own business and the
   doc never speaks to it — costs it computes, locks, ordering, ids. */
export const TRACKED = {
  "name":            "Trip name",
  "dates.start":     "Start date",
  "dates.end":       "End date",
  "travelers":       "Travellers",
  "segment.city":    "City",
  "segment.nights":  "Nights",
  "stay.name":       "Hotel",
  "stay.url":        "Hotel link",
  "stay.ref":        "Confirmation",
  "stay.total":      "Hotel total",
  "stay.notes":      "Hotel notes",
  "day.notes":       "Day notes",
};

/** The label for a dotted path, collapsing `stays.<id>.name` to `stay.name`. */
export function describeField(path) {
  const generic = path.replace(/^(segments|stays|days)\.[^.]+\./, (m, k) => `${k.replace(/s$/, "")}.`);
  return TRACKED[generic] || TRACKED[path] || path;
}

const norm = (v) => (v === null || v === undefined ? "" : String(v).trim());

/** Read a dotted path. Collections are addressed by id: `stays.stay_x.name`. */
export function fieldValue(trip, path) {
  const parts = path.split(".");
  let node = trip;
  for (const part of parts) {
    if (node === null || node === undefined) return "";
    node = Array.isArray(node) ? node.find((x) => x && x.id === part) : node[part];
  }
  return node === undefined ? "" : node;
}

/**
 * Every tracked field the doc has spoken about, with both sides' values.
 * `state` is "clean" or "drifted". A field the doc mentioned for a thing that
 * has since been deleted here comes back as "orphan" so it can be shown rather
 * than silently dropped.
 */
export function compare(trip) {
  const src = trip.source || blankSource();
  const rows = [];
  for (const [path, docValue] of Object.entries(src.fields || {})) {
    const owner = path.replace(/\.[^.]+$/, "");
    const exists = /^(segments|stays|days)\./.test(path) ? fieldValue(trip, owner) : trip;
    if (!exists) { rows.push({ path, label: describeField(path), docValue, tripValue: "", state: "orphan" }); continue; }
    const tripValue = fieldValue(trip, path);
    rows.push({
      path,
      label: describeField(path),
      docValue,
      tripValue,
      state: norm(tripValue) === norm(docValue) ? "clean" : "drifted",
    });
  }
  return rows;
}

/** Just the rows that disagree — what the source bar counts. */
export const driftList = (trip) => compare(trip).filter((r) => r.state !== "clean");

/* ------------------------------------------------------------------ apply */

/* Matching parsed doc entities onto existing trip ones. The doc has no ids, so
   the natural key is the name: the same city or hotel written the same way is
   the same thing. Loose enough to survive case and stray punctuation, strict
   enough not to merge "Hotel Artemide" into "Artemide Rooftop".

   The known limit: renaming a hotel in the doc reads as a different hotel, and
   you get both. That is not a bug to paper over — with no id in the doc, a
   rename and a replacement are the same edit, and inventing a rule to tell them
   apart would silently discard a real second option. Deleting the stale one is
   one tap; recovering a hotel the app decided was a typo is not. */
const key = (s) => norm(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Fold a parsed doc into a trip.
 *
 * `mode` decides what happens where the two disagree:
 *   "doc-wins"  take the doc's value (the normal pull)
 *   "record"    leave the trip alone, only update what the doc said
 *
 * Returns { trip, added, updated, kept } — counts for the confirmation, so the
 * import can tell you what it did before you accept it.
 */
export function applyDoc(trip, parsed, { mode = "doc-wins", now = new Date().toISOString(), by = "" } = {}) {
  const next = { ...trip, source: { ...blankSource(), ...(trip.source || {}) } };
  const fields = { ...(next.source.fields || {}) };
  const stat = { added: 0, updated: 0, kept: 0 };

  /* Record what the doc said, and take it unless the trip has since diverged
     and we were told only to record. */
  const put = (obj, path, prop, value) => {
    if (norm(value) === "") return;
    const was = fields[path];
    const here = norm(obj[prop]);
    fields[path] = value;
    if (here === norm(value)) return;
    if (mode === "record" && was !== undefined && here !== norm(was)) { stat.kept++; return; }
    obj[prop] = value;
    stat.updated++;
  };

  if (parsed.name) put(next, "name", "name", parsed.name);
  if (parsed.dates) {
    next.dates = { ...next.dates };
    if (parsed.dates.start) put(next.dates, "dates.start", "start", parsed.dates.start);
    if (parsed.dates.end) put(next.dates, "dates.end", "end", parsed.dates.end);
  }
  if (parsed.travelers) put(next, "travelers", "travelers", parsed.travelers);

  /* Cities. Order in the doc is meaningful — it is the route — so a city the
     doc introduces lands at the end rather than being sorted in. */
  if (Array.isArray(parsed.segments) && parsed.segments.length) {
    const segs = next.segments.map((s) => ({ ...s }));
    for (const ps of parsed.segments) {
      let seg = segs.find((s) => key(s.city) === key(ps.city));
      if (!seg) { seg = { ...blankSegment(ps.city, ps.nights || 1) }; segs.push(seg); stat.added++; }
      put(seg, `segments.${seg.id}.city`, "city", ps.city);
      if (ps.nights) put(seg, `segments.${seg.id}.nights`, "nights", ps.nights);
    }
    next.segments = segs;
  }

  /* Hotels. Tied to a city when the doc named one, so a stay lands in the
     right segment instead of floating. */
  if (Array.isArray(parsed.stays) && parsed.stays.length) {
    const stays = next.stays.map((s) => ({ ...s }));
    for (const ps of parsed.stays) {
      let stay = stays.find((s) => key(s.name) === key(ps.name));
      if (!stay) { stay = { ...blankStay() }; stays.push(stay); stat.added++; }
      if (!stay.segmentId && ps.city) {
        const seg = (next.segments || []).find((s) => key(s.city) === key(ps.city));
        if (seg) stay.segmentId = seg.id;
      }
      const p = `stays.${stay.id}`;
      put(stay, `${p}.name`, "name", ps.name);
      if (ps.url) put(stay, `${p}.url`, "url", ps.url);
      if (ps.ref) put(stay, `${p}.ref`, "ref", ps.ref);
      if (ps.total) put(stay, `${p}.total`, "total", ps.total);
      if (ps.notes) put(stay, `${p}.notes`, "notes", ps.notes);
    }
    next.stays = stays;
  }

  /* Days are keyed by date, so there is nothing to match — but items are
     additive only. Deleting a line from the doc does not delete a plan you
     may have already booked. */
  if (parsed.days && Object.keys(parsed.days).length) {
    const days = { ...next.days };
    for (const [iso, pd] of Object.entries(parsed.days)) {
      const day = { notes: "", items: [], city: "", locked: false, ...(days[iso] || {}) };
      day.items = [...(day.items || [])];
      if (pd.notes) put(day, `days.${iso}.notes`, "notes", pd.notes);
      for (const it of pd.items || []) {
        if (day.items.some((x) => key(x.title) === key(it.title))) continue;
        day.items.push(it);
        stat.added++;
      }
      days[iso] = day;
    }
    next.days = days;
  }

  next.source = {
    ...next.source,
    kind: "gdoc",
    docUrl: parsed.docUrl || next.source.docUrl || "",
    docTitle: parsed.docTitle || next.source.docTitle || "",
    syncedAt: now,
    syncedBy: by || next.source.syncedBy || "",
    text: parsed.text === undefined ? next.source.text : parsed.text,
    fields,
  };
  next.updatedAt = now;
  return { trip: next, ...stat };
}

/** Accept the doc's value for one drifted field — the per-row "use the doc". */
export function acceptDoc(trip, path) {
  const docValue = ((trip.source || {}).fields || {})[path];
  if (docValue === undefined) return trip;
  const parts = path.split(".");
  const prop = parts.pop();

  if (parts.length === 0) return { ...trip, [prop]: docValue };

  const [head, id] = parts;
  if (head === "dates") return { ...trip, dates: { ...trip.dates, [prop]: docValue } };
  if (head === "days") {
    return { ...trip, days: { ...trip.days, [id]: { ...(trip.days[id] || {}), [prop]: docValue } } };
  }
  if (head === "segments" || head === "stays") {
    return { ...trip, [head]: trip[head].map((x) => (x.id === id ? { ...x, [prop]: docValue } : x)) };
  }
  return trip;
}

/** Keep what the trip holds — record it as the doc's value so it reads clean. */
export function keepMine(trip, path) {
  const src = { ...blankSource(), ...(trip.source || {}) };
  const fields = { ...(src.fields || {}) };
  fields[path] = fieldValue(trip, path);
  return { ...trip, source: { ...src, fields } };
}

/** Forget the doc entirely, leaving the trip's own values in place. */
export function detach(trip) {
  return { ...trip, source: blankSource() };
}
