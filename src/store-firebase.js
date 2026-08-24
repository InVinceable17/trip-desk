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
  getAuth, GoogleAuthProvider, signInWithPopup, getRedirectResult,
  onAuthStateChanged, signOut as fbSignOut,
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache,
  persistentMultipleTabManager, persistentSingleTabManager,
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
  /* Persistence is a convenience, not a requirement, and it is the part most
     likely to be unavailable: it needs IndexedDB, and the multi-tab manager
     additionally needs a cross-tab lock. Chrome on a phone with restricted
     site storage — or a private window — can refuse either. Insisting on the
     richest option and letting it fail leaves the client unable to complete a
     read at all, which surfaces as a spinner that never stops. So try for the
     best cache available and settle for less rather than for nothing. */
  const caches = [
    () => ({ localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }),
    () => ({ localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }) }),
    () => ({}),   // memory only: reads still work, they just do not survive a reload
  ];
  for (const make of caches) {
    try { db = initializeFirestore(app, make()); break; } catch { /* try the next */ }
  }
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

  /* Anyone who tried to sign in while the redirect fallback still existed has a
     half-finished redirect recorded in this origin's storage. Resolving it once
     at boot clears it; it can never succeed, and left in place it makes the SDK
     reach for the cross-origin handler on every load. Failure here is expected
     and uninteresting. */
  getRedirectResult(fbAuth).catch(() => {});
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
  /**
   * Popup only, deliberately.
   *
   * There used to be a `signInWithRedirect` fallback here for browsers that
   * block popups. It cannot work in this deployment and could only ever strand
   * you: the app is served from github.io while the auth handler lives on
   * <project>.firebaseapp.com, and the redirect flow correlates its result with
   * the pending sign-in through storage on that second origin. Every modern
   * mobile browser partitions third-party storage, so the handler comes back
   * from Google holding a perfectly good authorisation code, finds nothing to
   * match it against, and stops on a white page.
   *
   * The documented fix is to serve /__/auth/handler from the app's own domain.
   * GitHub Pages is static and cannot proxy, so that is not available. The
   * popup has no such problem — it posts its result straight back to the opener
   * rather than going through storage at all.
   *
   * This must stay callable synchronously from the click that triggers it, or
   * Safari treats the popup as unsolicited and blocks it.
   */
  async signIn() {
    if (!ready) throw new Error("Firebase isn't configured in this build.");
    await signInWithPopup(fbAuth, new GoogleAuthProvider());
  },
  signOut() { return ready ? fbSignOut(fbAuth) : Promise.resolve(); },
};

/**
 * Turn a Firebase error into something worth reading. Returns "" for the ones
 * that are not failures at all — closing the sign-in window is a decision, and
 * shouting about it is how an app teaches you to distrust its warnings.
 */
export function describeAuthError(e) {
  const code = (e && e.code) || "";
  if (code.includes("popup-closed-by-user")) return "";
  if (code.includes("cancelled-popup-request")) return "";
  if (code.includes("popup-blocked")) {
    return "Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.";
  }
  if (code.includes("operation-not-supported")) {
    return "This browser won't open the sign-in window. Opening the site in a normal browser tab usually fixes it.";
  }
  if (code.includes("unauthorized-domain")) return "This domain isn't in the Firebase authorised list yet.";
  if (code.includes("requests-from-referer") || code.includes("api-key-not-valid")) {
    return "The API key is restricted and doesn't allow this site. Check the key's website restrictions.";
  }
  if (code.includes("network-request-failed")) return "No connection to Firebase.";
  if (code === "permission-denied") return "Signed in, but this account isn't on the allowlist.";
  return (e && e.message) || "Sign-in failed.";
}

/* ------------------------------------------------------------------- read */

/* Long enough that a slow phone on a bad connection still gets its real data,
   short enough that a client which is never going to answer says so while you
   are still looking at the screen. */
const LOAD_TIMEOUT = 15000;

/** What went wrong loading, in words, or "" when nothing did. */
export function describeLoadError(e) {
  const code = (e && e.code) || "";
  if (code === "load-timeout") {
    return "Couldn't reach Firestore, so these are the trips this browser had saved. "
      + "If this browser blocks site storage, that's usually the cause.";
  }
  if (code === "permission-denied") {
    return "Signed in, but this account isn't on the allowlist — showing what this browser had saved.";
  }
  if (code === "unavailable" || code.includes("network")) {
    return "Offline, so these are the trips this browser had saved.";
  }
  return e ? "Couldn't load from Firestore — showing what this browser had saved." : "";
}

export async function loadAll() {
  if (!ready || !currentUser) {
    return { trips: {}, order: [], entries: [], prefs: {}, missing: [], migrated: false };
  }
  try {
    /* Firestore reads normally either resolve or reject. They can also do
       neither: if the client cannot bring its local cache up, the read is
       queued against a backend that never becomes ready and simply never
       settles. Awaited bare, that is a spinner with no end and nothing to
       report — so give it a deadline and treat silence as a failure like any
       other. The catch below already knows how to fall back. */
    const [idxSnap, tripSnaps] = await Promise.race([
      Promise.all([
        getDoc(doc(db, "meta", "index")),
        getDocs(collection(db, "trips")),
      ]),
      new Promise((_, reject) => setTimeout(() => {
        const e = new Error("Firestore didn't answer within 15 seconds.");
        e.code = "load-timeout";
        reject(e);
      }, LOAD_TIMEOUT)),
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
