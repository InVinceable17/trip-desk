import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";

import { label as dayLabel } from "./flights.js";
import {
  PANELS, PANEL_KEYS, blankTrip, hydrateTrip, phaseState, tripCost, tripNights,
  openQuestions, fmtMoney,
} from "./model.js";
import { loadAll, makeSaver, MODE, auth, describeAuthError, describeLoadError, HOSTED } from "./store.js";
import * as backend from "./backend.js";
import { Btn, Spinner } from "./components/ui.jsx";
import CostBreakdown from "./components/CostBreakdown.jsx";
import TripTimeline from "./components/TripTimeline.jsx";

import Trips from "./views/Trips.jsx";
import Dates from "./views/Dates.jsx";
import Flights from "./views/Flights.jsx";
import Cities from "./views/Cities.jsx";
import Stays from "./views/Stays.jsx";
import Itinerary from "./views/Itinerary.jsx";
import Backup from "./views/Backup.jsx";
import SignIn from "./views/SignIn.jsx";
import { SourceBar } from "./views/Source.jsx";

const VIEWS = { dates: Dates, flights: Flights, cities: Cities, stays: Stays };

/* ------------------------------------------------------------------ route */

function parseHash() {
  if (/^#\/backup/.test(location.hash || "")) return { view: "backup" };
  const m = /^#\/t\/([^/]+)(?:\/([^/]+))?/.exec(location.hash || "");
  if (!m) return { view: "trips" };
  /* `days` was its own phase before the itinerary became the permanent left
     column; old links still resolve, they just land on the first panel. */
  return { view: "trip", id: m[1], panel: PANEL_KEYS.includes(m[2]) ? m[2] : "dates" };
}

function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

const go = (hash) => { location.hash = hash; };

/* -------------------------------------------------------------------- app */

function App() {
  const route = useRoute();
  const [db, setDb] = useState(null);            // { trips, order, prefs }
  const [missing, setMissing] = useState([]);
  const [mode, setMode] = useState(MODE.SAVING);
  const [note, setNote] = useState("");
  const [mcp, setMcp] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [user, setUser] = useState(auth.enabled ? undefined : null);  // undefined = still deciding

  const saver = useRef(null);
  const dbRef = useRef(null);
  dbRef.current = db;

  useEffect(() => {
    if (!auth.enabled) return undefined;
    return auth.onChange((u) => setUser(u || null));
  }, []);

  useEffect(() => {
    if (auth.enabled && !user) return undefined;   // nothing to load until signed in
    let alive = true;
    (async () => {
      const use = (n) => (window.claude && window.claude.use ? window.claude.use(n) : Promise.resolve(null));
      const [artifact, mcpNs] = await Promise.all([use("artifact").catch(() => null), use("mcp").catch(() => null)]);
      if (!alive) return;
      setMcp(mcpNs);
      saver.current = makeSaver(artifact, (m, msg) => { setMode(m); setNote(msg); });

      const loaded = await loadAll();
      if (!alive) return;
      // A degraded load still puts you in the app; it just says so rather than
      // presenting whatever it salvaged as the whole truth.
      if (loaded.error) setNote(describeLoadError(loaded.error));
      const next = { trips: loaded.trips, order: loaded.order, prefs: loaded.prefs };
      setDb(next);
      setMissing(loaded.missing || []);
      // A migrated store must be written out in the new layout straight away.
      if (loaded.migrated && saver.current) saver.current.save(next, loaded.order);
    })();
    return () => { alive = false; };
  }, [user]);

  /* Another device edited the same trips. Only take the update when nothing of
     ours is waiting to be written, so a remote echo can't clobber typing. */
  useEffect(() => {
    if (!backend.watchAll || (auth.enabled && !user)) return undefined;
    return backend.watchAll((remoteTrips) => {
      if (saver.current && saver.current.pending) return;
      const cur = dbRef.current;
      if (!cur) return;
      const ids = Object.keys(remoteTrips);
      const same = ids.length === cur.order.length
        && ids.every((id) => cur.trips[id] && cur.trips[id].updatedAt === remoteTrips[id].updatedAt);
      if (same) return;
      const order = [...cur.order.filter((id) => remoteTrips[id]), ...ids.filter((id) => !cur.order.includes(id))];
      const next = { ...cur, trips: remoteTrips, order };
      setDb(next);
      dbRef.current = next;
    });
  }, [user]);

  /* Report the save queue without spamming — a quiet dot in the header. */
  useEffect(() => {
    const t = setInterval(() => setSaving(!!(saver.current && saver.current.pending)), 700);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const on = () => { if (saver.current) saver.current.flushNow(); };
    addEventListener("visibilitychange", on);
    addEventListener("pagehide", on);
    return () => { removeEventListener("visibilitychange", on); removeEventListener("pagehide", on); };
  }, []);

  const commit = useCallback((next, touched) => {
    setDb(next);
    dbRef.current = next;
    if (saver.current) saver.current.save(next, touched);
  }, []);

  const updateTrip = useCallback((id, fn) => {
    const cur = dbRef.current;
    if (!cur || !cur.trips[id]) return;
    const updated = { ...fn(cur.trips[id]), updatedAt: new Date().toISOString() };
    commit({ ...cur, trips: { ...cur.trips, [id]: updated } }, [id]);
  }, [commit]);

  const newTrip = useCallback(() => {
    const cur = dbRef.current || { trips: {}, order: [], prefs: {} };
    const t = blankTrip(`Trip ${cur.order.length + 1}`);
    commit({ ...cur, trips: { ...cur.trips, [t.id]: t }, order: [...cur.order, t.id] }, [t.id]);
    go(`#/t/${t.id}/dates`);
  }, [commit]);

  const duplicateTrip = useCallback((id) => {
    const cur = dbRef.current;
    const src = cur && cur.trips[id];
    if (!src) return;
    const copy = hydrateTrip({
      ...JSON.parse(JSON.stringify(src)),
      id: blankTrip().id,
      name: `${src.name} (copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      flights: { ...src.flights, bookedId: null, booking: { ref: "", paidTotal: "" } },
    });
    commit({ ...cur, trips: { ...cur.trips, [copy.id]: copy }, order: [...cur.order, copy.id] }, [copy.id]);
  }, [commit]);

  const restoreAll = useCallback((next) => {
    commit({ trips: next.trips, order: next.order, prefs: next.prefs || {} }, next.order);
    go("#/");
  }, [commit]);

  const deleteTrip = useCallback((id) => {
    const cur = dbRef.current;
    if (!cur) return;
    const trips = { ...cur.trips };
    delete trips[id];
    commit({ ...cur, trips, order: cur.order.filter((x) => x !== id) }, [id]);
    if (route.view === "trip" && route.id === id) go("#/");
  }, [commit, route]);

  if (auth.enabled && user === undefined) return <div className="boot"><Spinner /> Checking your account…</div>;
  if (auth.enabled && user === null) return <SignIn auth={auth} describeError={describeAuthError} />;
  if (!db) return <div className="boot"><Spinner /> Opening your trips…</div>;

  const readOnly = mode === MODE.READONLY;
  const trip = route.view === "trip" ? db.trips[route.id] : null;
  const who = (user && (user.displayName || user.email)) || "";

  return (
    <div className="wrap">
      <Header
        trip={trip} saving={saving} mode={mode}
        onHome={() => go("#/")}
        onRename={(name) => updateTrip(trip.id, (t) => ({ ...t, name }))}
        onCost={() => setCostOpen((v) => !v)}
        costOpen={costOpen}
        readOnly={readOnly}
      />

      {trip && costOpen && (
        <CostBreakdown trip={trip} readOnly={readOnly}
          update={(fn) => updateTrip(trip.id, fn)} onClose={() => setCostOpen(false)} />
      )}

      {note && <div className="banner warn">{note}</div>}
      {!HOSTED && mcp === null && route.view === "trip" && route.panel === "flights" && (
        <div className="banner warn">
          Price checks are off — no Browserless connector. Fare links still open Google Flights.
        </div>
      )}

      {route.view === "backup" && (
        <Backup db={db} readOnly={readOnly} onRestore={restoreAll} />
      )}

      {route.view === "trips" && (
        <Trips
          trips={db.trips} order={db.order} missing={missing} readOnly={readOnly}
          onOpen={(id) => go(`#/t/${id}/dates`)}
          onNew={newTrip} onDuplicate={duplicateTrip} onDelete={deleteTrip}
        />
      )}

      {route.view === "trip" && !trip && (
        <div className="card"><div className="card-body">
          <div className="empty">That trip isn't here any more.</div>
          <div className="row-wrap center"><Btn kind="solid" onClick={() => go("#/")}>Back to trips</Btn></div>
        </div></div>
      )}

      {route.view === "trip" && trip && (
        <>
          <Questions trip={trip} onGo={(p) => go(`#/t/${trip.id}/${p}`)} />

          {/* Two columns: the trip as written on the left, the place you work
              it out on the right. The document is never navigated away from,
              so there is always an answer on screen to "what is this trip". */}
          <div className="desk">
            <div className="desk-doc">
              <Itinerary
                trip={trip} readOnly={readOnly}
                update={(fn) => updateTrip(trip.id, fn)}
                onGo={(p) => go(`#/t/${trip.id}/${p}`)}
              />
            </div>

            <div className="desk-work">
              <Tabs trip={trip} panel={route.panel} onGo={(p) => go(`#/t/${trip.id}/${p}`)} />
              <SourceBar
                trip={trip} readOnly={readOnly} who={who}
                update={(fn) => updateTrip(trip.id, fn)}
              />
              <TripTimeline
                trip={trip} phase={route.panel} readOnly={readOnly}
                update={(fn) => updateTrip(trip.id, fn)}
              />
              <PanelView
                key={`${trip.id}:${route.panel}`}
                panel={route.panel} trip={trip} mcp={mcp} readOnly={readOnly}
                update={(fn) => updateTrip(trip.id, fn)}
              />
            </div>
          </div>
        </>
      )}

      <footer className="foot">
        {mode === MODE.SAVING ? (saving ? "Saving…" : "Saved")
          : mode === MODE.READONLY ? "Read-only"
            : "This browser only"}
      </footer>
    </div>
  );
}

function PanelView({ panel, ...props }) {
  const V = VIEWS[panel] || Dates;
  return <V {...props} />;
}

/* ----------------------------------------------------------------- header */

function Header({ trip, saving, mode, onHome, onRename, onCost, costOpen, readOnly }) {
  const [editing, setEditing] = useState(false);
  const cost = trip ? tripCost(trip) : null;
  const nights = trip ? tripNights(trip) : 0;

  return (
    <header className="head">
      <div className="head-left">
        <button className="brand" onClick={onHome} aria-label="All trips">
          <span className="brandmark" aria-hidden="true" />
          <span className="brandword">Trip Desk</span>
        </button>
        {trip && (
          <div className="crumb">
            <span className="sep">/</span>
            {editing && !readOnly ? (
              <input
                className="rename" autoFocus defaultValue={trip.name}
                onBlur={(e) => { onRename(e.target.value.trim() || trip.name); setEditing(false); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
            ) : (
              <button className="tripname-btn" onClick={() => setEditing(true)} disabled={readOnly}>
                {trip.name || "Untitled trip"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="head-right">
        {trip ? (
          <>
            <div className="head-dates">
              {trip.dates.start
                ? <>{dayLabel(trip.dates.start)} – {dayLabel(trip.dates.end)}{nights ? ` · ${nights}n` : ""}</>
                : "no dates"}
              {" · "}{trip.travelers}p
            </div>
            <div className="head-cost">
              <button className={`costbtn${costOpen ? " on" : ""}`} onClick={onCost}
                aria-expanded={costOpen} title="What makes up this total">
                {cost.total ? (
                  <>
                    <span className="num">{fmtMoney(cost.total, cost.base)}</span>
                    <span className="est">{cost.due > 0 ? `${fmtMoney(cost.paid, cost.base)} paid` : "all paid"}</span>
                  </>
                ) : <span className="muted">no costs yet</span>}
                <span className="caret" aria-hidden="true">{costOpen ? "▴" : "▾"}</span>
              </button>
              <button className="link" onClick={() => go("#/backup")}>backups</button>
            </div>
          </>
        ) : (
          <div className="head-dates">
            {mode === MODE.SAVING ? (saving ? "saving…" : "all changes saved") : mode === MODE.READONLY ? "read-only" : "local only"}
          </div>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------- tabs */
/* Deliberately not numbered. A stepper says "you are on 3 of 5 and behind";
   these are four places to work, in no order, any of which you may be in the
   middle of. The dot carries the same phaseState the trip list uses, so
   progress is still legible without implying a route through it. */

function Tabs({ trip, panel, onGo }) {
  /* Stacked into one column, the workbench sits under the itinerary. A tab is
     a request to work on something, so bring the work up to meet the thumb. */
  const reach = () => {
    if (matchMedia("(min-width: 1080px)").matches) return;
    const el = document.querySelector(".desk-work");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="tabs" aria-label="Planning">
      {PANELS.map((p) => {
        const st = phaseState(trip, p.key);
        const on = p.key === panel;
        return (
          <button key={p.key} className={`tab ${st}${on ? " on" : ""}`}
            aria-current={on ? "page" : undefined}
            onClick={() => { onGo(p.key); reach(); }}>
            <i className={`dot is-${st}`} aria-hidden="true" />
            {p.label}
          </button>
        );
      })}
    </nav>
  );
}

/* -------------------------------------------------------- open questions */
/* What nobody has decided yet, phrased as the decision. This is the guidance
   the stepper only pretended to give: it says what is actually unsettled
   rather than which numbered box you are standing in, and each one is a way
   into the panel that settles it. Empty means the trip is planned. */

function Questions({ trip, onGo }) {
  const qs = openQuestions(trip);
  if (!qs.length) return null;
  return (
    <div className="asks">
      {qs.map((q) => (
        q.panel
          ? (
            <button key={q.id} className={`ask${q.blocking ? " blocking" : ""}`}
              onClick={() => onGo(q.panel)}>{q.text}</button>
          )
          : <span key={q.id} className="ask flat">{q.text}</span>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
