/* ============================================================================
   store-firebase.js — trips kept in Firestore, for the hosted build.

   Shape:
     trips/{tripId}   one trip document
     meta/index       { schema, order: [tripId], prefs }

   One shared workspace rather than per-user collections, so everyone on the
   allowlist sees the same trips — which is the point when two people are
   planning one holiday. Who may touch it is decided by the security rules
   (firestore.rules), not by anything in this file: the config below is public
   by design and is not a credential.

   Firestore's own local cache does the offline work — reads and writes both
   succeed with no connection and reconcile when there is one — so this file
   does not reimplement any of that.
   ========================================================================== */

import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut as fbSignOut,
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch, onSnapshot,
} from "firebase/firestore";

import { SCHEMA, hydrateTrip, indexEntry, seedTrips } from "./model.js";
import { MODE, cacheStore, readCachedStore } from "./store-common.js";

/* Injected at build time from firebase.config.json — see build-web.mjs. */
const CONFIG = typeof __FIREBASE_CONFIG__ !== "undefined" ? __FIREBASE_CONFIG__ : null;

let app = null, db = null, fbAuth = null;
const ready = (() => {
  if (!CONFIG || !CONFIG.projectId) return false;
  app = initializeApp(CONFIG);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  fbAuth = getAuth(app);
  return true;
})();

/* ------------------------------------------------------------------- auth */

let currentUser = null;
const listeners = new Set();

if (ready) {
  onAuthStateChanged(fbAuth, (u) => {
    currentUser = u;
    listeners.forEach((fn) => fn(u));
  });
}

/** Running as an ordinary website — no Claude connectors reachable from here. */
export const HOSTED = true;

export const auth = {
  enabled: true,
  configured: ready,
  get user() { return currentUser; },
  onChange(fn) {
    listeners.add(fn);
    fn(currentUser);
    return () => listeners.delete(fn);
  },
  async signIn() {
    if (!ready) throw new Error("Firebase isn't configured in this build.");
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(fbAuth, provider);
    } catch (e) {
      // Popups are blocked on plenty of mobile browsers; fall back rather than
      // leaving the person staring at a button that does nothing.
      const code = (e && e.code) || "";
      if (/popup-blocked|popup-closed-by-user|operation-not-supported/.test(code)) {
        await signInWithRedirect(fbAuth, provider);
        return;
      }
      throw e;
    }
  },
  signOut() { return ready ? fbSignOut(fbAuth) : Promise.resolve(); },
};

/** Turn a Firebase error into something worth reading. */
export function describeAuthError(e) {
  const code = (e && e.code) || "";
  if (code.includes("popup-blocked")) return "Your browser blocked the sign-in window.";
  if (code.includes("unauthorized-domain")) return "This domain isn't in the Firebase authorised list yet.";
  if (code.includes("network-request-failed")) return "No connection to Firebase.";
  if (code === "permission-denied") return "Signed in, but this account isn't on the allowlist.";
  return (e && e.message) || "Sign-in failed.";
}

/* ------------------------------------------------------------------- read */

export async function loadAll() {
  if (!ready || !currentUser) {
    return { trips: {}, order: [], entries: [], prefs: {}, missing: [], migrated: false };
  }
  try {
    const [idxSnap, tripSnaps] = await Promise.all([
      getDoc(doc(db, "meta", "index")),
      getDocs(collection(db, "trips")),
    ]);

    const trips = {};
    tripSnaps.forEach((d) => { trips[d.id] = hydrateTrip({ ...d.data(), id: d.id }); });

    const idx = idxSnap.exists() ? idxSnap.data() : null;
    const known = Object.keys(trips);
    // The index only orders things; a trip missing from it is still a trip.
    const order = idx && Array.isArray(idx.order)
      ? [...idx.order.filter((id) => trips[id]), ...known.filter((id) => !idx.order.includes(id))]
      : known;

    if (!order.length) {
      // A brand-new workspace opens onto the trip the app ships with.
      const seeded = {};
      const seedOrder = [];
      seedTrips().forEach((t) => { seeded[t.id] = t; seedOrder.push(t.id); });
      return {
        trips: seeded, order: seedOrder,
        entries: seedOrder.map((id) => indexEntry(seeded[id])),
        prefs: { seeded: true }, missing: [], migrated: true,
      };
    }

    return {
      trips, order,
      entries: order.map((id) => indexEntry(trips[id])),
      prefs: (idx && idx.prefs) || {},
      missing: [],
      migrated: false,
    };
  } catch (e) {
    // Offline with a cold cache, or the rules said no. Fall back to whatever
    // this browser already had rather than showing an empty desk.
    const cached = readCachedStore();
    if (cached && cached.trips) {
      const trips = {};
      Object.entries(cached.trips).forEach(([id, t]) => { trips[id] = hydrateTrip(t); });
      const order = cached.order || Object.keys(trips);
      return { trips, order, entries: order.map((id) => indexEntry(trips[id])), prefs: cached.prefs || {}, missing: [], migrated: false, error: e };
    }
    return { trips: {}, order: [], entries: [], prefs: {}, missing: [], migrated: false, error: e };
  }
}

/** Live updates from other devices. Ignores echoes of our own writes. */
export function watchAll(onRemote) {
  if (!ready || !currentUser) return () => {};
  const stop = onSnapshot(collection(db, "trips"), (snap) => {
    if (snap.metadata.hasPendingWrites) return;   // our own edit coming back
    const trips = {};
    snap.forEach((d) => { trips[d.id] = hydrateTrip({ ...d.data(), id: d.id }); });
    onRemote(trips);
  }, () => { /* a dropped listener is not worth interrupting anyone over */ });
  return stop;
}

/* ------------------------------------------------------------------ write */

export function makeSaver(_unused, onMode) {
  let timer = null;
  let dirty = new Set();
  let snapshot = null;
  let mode = ready ? MODE.SAVING : MODE.LOCAL;
  if (!ready) onMode(MODE.LOCAL, "Firebase isn't configured in this build — changes stay in this browser.");

  const flush = async () => {
    timer = null;
    const database = snapshot;
    if (!database || !dirty.size) return;
    cacheStore(database);
    if (!ready || !currentUser) { dirty = new Set(); return; }

    const sent = new Set(dirty);
    dirty = new Set();

    try {
      const batch = writeBatch(db);
      sent.forEach((id) => {
        const t = database.trips[id];
        if (t) batch.set(doc(db, "trips", id), t);
        else batch.delete(doc(db, "trips", id));
      });
      batch.set(doc(db, "meta", "index"), {
        schema: SCHEMA,
        order: database.order,
        prefs: database.prefs || {},
        updatedAt: new Date().toISOString(),
      });
      await batch.commit();
      onMode(MODE.SAVING, "");
    } catch (e) {
      sent.forEach((id) => dirty.add(id));
      const code = (e && e.code) || "";
      if (code === "permission-denied") {
        mode = MODE.READONLY;
        onMode(MODE.READONLY, "This account isn't allowed to write these trips. Changes stay in this browser.");
      } else if (code === "unavailable") {
        // Firestore queues offline writes itself; this is only reached when
        // the SDK gives up entirely.
        onMode(mode, "Offline — your work is held here and will sync when you're back.");
      } else {
        onMode(mode, "Couldn't save just now. Your work is safe in this browser; it'll retry on the next change.");
      }
    }
  };

  return {
    save(database, touched) {
      snapshot = database;
      (touched || []).forEach((id) => dirty.add(id));
      cacheStore(database);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 1200);
    },
    flushNow() {
      if (timer) clearTimeout(timer);
      return flush();
    },
    get mode() { return mode; },
    get pending() { return dirty.size > 0; },
  };
}

/** Remove a trip document outright rather than leaving an orphan. */
export async function purgeTrip(id) {
  if (!ready || !currentUser) return;
  try { await deleteDoc(doc(db, "trips", id)); } catch { /* the batch delete already tried */ }
}
