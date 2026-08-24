/* ============================================================================
   store-artifact.js — trips kept inside the published Claude artifact.

   Layout:
     data/index.json        { schema, trips: [entry], prefs }
     data/trips/<id>.json   one full trip

   The `artifact` files form publishes only the paths that changed, which is
   exactly right for per-trip files. One trap shapes the whole design:

     "Relative URLs in this view still serve the version it loaded."

   So after this page saves, its own `fetch("./data/trips/x.json")` returns the
   PRE-SAVE content, and a trip file created this session 404s. Lazy-loading a
   trip on open would therefore read stale or missing data. Instead the page
   loads every trip at boot and holds them in memory for the session; saves are
   write-through.
   ========================================================================== */

import { SCHEMA, hydrateTrip, indexEntry, migrateV1, seedTrips } from "./model.js";
import { MODE, cacheStore, readCachedStore } from "./store-common.js";

const INDEX = "data/index.json";
const V1 = "data/state.json";
const tripPath = (id) => `data/trips/${id}.json`;

/** This backend has no accounts — the artifact's own sharing is the boundary. */
export const auth = { enabled: false };
/** Running inside the Claude artifact, where the connector tools exist. */
export const HOSTED = false;
/** No cross-device channel here — one artifact view is the only writer. */
export const watchAll = null;
export const describeAuthError = (e) => (e && e.message) || "Sign-in failed.";
/* Both backends answer this so the app can report a bad load the same way,
   whichever one it was built against. */
export const describeLoadError = (e) => (e ? (e.message || "Couldn't load your trips.") : "");

const readJson = async (path) => {
  try {
    const r = await fetch(`./${path}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};

/**
 * Read everything. Returns { trips: {id: trip}, order: [id], prefs, migrated }.
 * `migrated` means the caller should save immediately to persist the new layout.
 */
export async function loadAll() {
  const idx = await readJson(INDEX);

  // An index that exists is authoritative, even when it lists no trips — that
  // is a desk the user emptied on purpose, not one that needs seeding.
  if (idx && idx.schema >= SCHEMA && Array.isArray(idx.trips)) {
    const loaded = await Promise.all(
      idx.trips.map(async (e) => [e.id, await readJson(tripPath(e.id))]),
    );
    const trips = {};
    const missing = [];
    loaded.forEach(([id, t]) => {
      if (t) trips[id] = hydrateTrip(t);
      else missing.push(id);
    });
    // A trip file that won't load is reported, never silently dropped.
    return {
      trips,
      order: idx.trips.map((e) => e.id),
      entries: idx.trips,
      prefs: idx.prefs || {},
      missing,
      migrated: false,
    };
  }

  // No v2 index. Try the v1 single-trip file.
  const v1 = await readJson(V1);
  if (v1) {
    const t = migrateV1(v1);
    if (t) {
      return { trips: { [t.id]: t }, order: [t.id], entries: [indexEntry(t)], prefs: {}, missing: [], migrated: true };
    }
  }

  // Nothing on the artifact — fall back to whatever this browser cached.
  const cached = readCachedStore();
  if (cached && cached.trips) {
    const trips = {};
    Object.entries(cached.trips).forEach(([id, t]) => { trips[id] = hydrateTrip(t); });
    return {
      trips,
      order: cached.order || Object.keys(trips),
      entries: (cached.order || Object.keys(trips)).map((id) => indexEntry(trips[id])).filter(Boolean),
      prefs: cached.prefs || {},
      missing: [],
      migrated: false,
    };
  }

  // Nothing anywhere and never seeded: open onto the trip v1 shipped with.
  const trips = {};
  const order = [];
  seedTrips().forEach((t) => { trips[t.id] = t; order.push(t.id); });
  return {
    trips, order,
    entries: order.map((id) => indexEntry(trips[id])),
    prefs: { seeded: true },
    missing: [],
    migrated: true,
  };
}

/**
 * Write-through saver. Collects the trip ids touched since the last flush and
 * publishes only those files plus the index, in one call.
 */
export function makeSaver(artifact, onMode) {
  let timer = null;
  let dirty = new Set();
  let indexDirty = false;
  let snapshot = null;
  let mode = artifact ? MODE.SAVING : MODE.LOCAL;
  if (!artifact) onMode(MODE.LOCAL, "Saving to this browser only — the artifact's own storage isn't available here.");

  const buildFiles = (db) => {
    const files = {};
    dirty.forEach((id) => {
      files[tripPath(id)] = db.trips[id] ? JSON.stringify(db.trips[id], null, 2) : null; // null deletes
    });
    if (indexDirty || dirty.size) {
      files[INDEX] = JSON.stringify({
        schema: SCHEMA,
        trips: db.order.map((id) => db.trips[id]).filter(Boolean).map(indexEntry),
        prefs: db.prefs || {},
      }, null, 2);
    }
    return files;
  };

  const flush = async () => {
    timer = null;
    const db = snapshot;
    if (!db || (!dirty.size && !indexDirty)) return;
    cacheStore(db);
    if (mode !== MODE.SAVING) { dirty = new Set(); indexDirty = false; return; }

    const files = buildFiles(db);
    const sent = new Set(dirty);
    dirty = new Set();
    indexDirty = false;

    try {
      await artifact.publish(files);
      onMode(MODE.SAVING, "");
    } catch (e) {
      const code = (e && e.code) || "upstream_error";
      if (code === "conflict") return; // the shell is already reloading this view

      // Anything that didn't land goes back on the queue.
      sent.forEach((id) => dirty.add(id));
      indexDirty = true;

      if (code === "not_writer" || code === "not_granted" || code === "consent_required") {
        mode = MODE.READONLY;
        onMode(MODE.READONLY, "You're viewing this read-only. Changes stay in this browser.");
      } else if (code === "capability_disabled" || code === "capability_removed" || code === "not_declared") {
        mode = MODE.LOCAL;
        onMode(MODE.LOCAL, "Saving to this browser only — the artifact's own storage isn't available here.");
      } else if (code === "too_large") {
        onMode(mode, "This trip has grown too large to store. Export it and trim some options.");
      } else if (code === "rate_limited") {
        onMode(mode, "Saving too fast — slowing down.");
        timer = setTimeout(flush, 10000);
      } else {
        onMode(mode, "Couldn't save just now. Your work is safe in this browser; it'll retry on the next change.");
      }
    }
  };

  return {
    /** `db` is the whole in-memory store; `touched` the trip ids that changed. */
    save(db, touched) {
      snapshot = db;
      (touched || []).forEach((id) => dirty.add(id));
      indexDirty = true;
      cacheStore(db);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 2000);
    },
    flushNow() {
      if (timer) clearTimeout(timer);
      return flush();
    },
    get mode() { return mode; },
    get pending() { return dirty.size > 0 || indexDirty; },
  };
}
