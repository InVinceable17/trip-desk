/* ============================================================================
   store-common.js — the parts of persistence that don't care where data lives.

   Snapshots, the unsaved-draft stash, and the portable backup bundle behave
   identically whether the trips are kept in a Claude artifact or in Firestore.
   The backend-specific half (loadAll / makeSaver / auth) lives in
   store-artifact.js and store-firebase.js, and `backend.js` picks one at build
   time — see build.mjs and build-web.mjs.
   ========================================================================== */

import { SCHEMA, hydrateTrip } from "./model.js";

const CACHE = "tripdesk:all";
const DRAFT = "tripdesk:unsaved";
const SNAPS = "tripdesk:snapshots";
const SNAP_KEEP = 25;          // roughly a working week of edits
const SNAP_GAP_MS = 3 * 60000; // don't stack a snapshot per keystroke burst

export const MODE = { SAVING: "saving", LOCAL: "local", READONLY: "readonly" };

const readJson = async (path) => {
  try {
    const r = await fetch(`./${path}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
};

const cacheAll = (db) => {
  try { localStorage.setItem(CACHE, JSON.stringify(db)); } catch { /* blocked storage */ }
  pushSnapshot(db);
};
const readCache = () => {
  try {
    const raw = localStorage.getItem(CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

/* --------------------------------------------------------------- snapshots */
/* A rolling history of whole-store states, kept in this browser. It needs no
   permission and no network, so it is the one backup that always happens. A
   published page cannot write to disk on its own — `downloads.save` always
   asks — so the file export below is the deliberate, click-to-confirm half. */

export function readSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPS);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function pushSnapshot(db) {
  try {
    const list = readSnapshots();
    const now = Date.now();
    const last = list[0];
    const body = JSON.stringify(db);
    if (last && last.body === body) return;                 // nothing changed
    if (last && now - last.at < SNAP_GAP_MS) {
      // Coalesce a burst of edits into the newest entry.
      list[0] = { at: now, trips: db.order.length, body };
    } else {
      list.unshift({ at: now, trips: db.order.length, body });
    }
    localStorage.setItem(SNAPS, JSON.stringify(list.slice(0, SNAP_KEEP)));
  } catch { /* storage full or blocked — the artifact copy is still the truth */ }
}

export function restoreSnapshot(at) {
  const hit = readSnapshots().find((s) => s.at === at);
  if (!hit) return null;
  try {
    const db = JSON.parse(hit.body);
    const trips = {};
    Object.entries(db.trips || {}).forEach(([id, t]) => { trips[id] = hydrateTrip(t); });
    return { trips, order: db.order || Object.keys(trips), prefs: db.prefs || {} };
  } catch { return null; }
}

/** The whole desk as a portable file, for the download button and for Claude. */
export const exportBundle = (db) => JSON.stringify({
  kind: "tripdesk-backup",
  schema: SCHEMA,
  exportedAt: new Date().toISOString(),
  order: db.order,
  prefs: db.prefs || {},
  trips: db.order.map((id) => db.trips[id]).filter(Boolean),
}, null, 2);

/** Read a backup file back. Returns null rather than throwing on junk. */
export function importBundle(text) {
  try {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j : Array.isArray(j.trips) ? j.trips : [j];
    const trips = {};
    const order = [];
    list.forEach((t) => {
      if (!t || !t.id) return;
      trips[t.id] = hydrateTrip(t);
      order.push(t.id);
    });
    if (!order.length) return null;
    return { trips, order: Array.isArray(j.order) && j.order.length ? j.order.filter((id) => trips[id]) : order, prefs: j.prefs || {} };
  } catch { return null; }
}

export const stashDraft = (d) => {
  try { sessionStorage.setItem(DRAFT, JSON.stringify(d)); } catch { /* ignore */ }
};
export const takeDraft = () => {
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

/** Mirror the whole store into this browser, and take a snapshot of it. */
export const cacheStore = cacheAll;
export const readCachedStore = readCache;
