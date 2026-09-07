import React, { useState, useEffect, useMemo } from "react";
import { dayOf } from "../flights.js";
import { cityForDay, dayStay, travelOn, KIND_GLYPH, fmtMoney } from "../model.js";
import { docDays, to12h } from "../doc-emit.js";
import { itemUrl, itemRoute, stayUrl, legPlaceUrl, dayBase } from "../maps.js";

/* ============================================================================
   Today.jsx — the trip on the day you are having it.

   The five phases are for deciding; this is for the morning you wake up in
   Florence with one hand free. So it is a different screen and not a denser
   version of the same one: one day at a time, no ribbon, no stepper, no cost
   bar, nothing you can edit and therefore nothing you can break with a thumb.

   Two things earn their space. Where you are sleeping, once, at the top —
   because it is the answer to "where do I go back to" and the start of every
   route below it. And, for each thing on the list, two large targets: the
   place itself, and how to get to it from that bed.

   The order is the order it was written in. Sorting the day by clock time is
   tempting and wrong: half the lines have no time, the plan someone wrote is
   a sequence, and a view that rearranges it is a view that disagrees with the
   document it came from.

   `#/t/<id>/today` always opens on the real current date when the trip is
   running, so the URL can go on a phone's home screen and be right every
   morning without anyone editing it.
   ========================================================================== */

const MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/* Her abbreviations, the ones doc-emit writes — TUES and THUR, not TUE and
   THU. This screen is read beside the document it came from, and two spellings
   of Tuesday between them is a small thing you have to think about. */
const DOW_DOC = ["SUN", "MON", "TUES", "WED", "THUR", "FRI", "SAT"];

/** Today where the reader is standing, not where the server thinks they are. */
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const headline = (iso) => `${DOW_DOC[dayOf(iso)]} · ${MONTH[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** A big tap target that leaves the app. Never a button: these open Maps. */
const Go = ({ href, children, kind = "" }) => (href ? (
  <a className={`do-btn ${kind}`} href={href} target="_blank" rel="noreferrer">{children}</a>
) : null);

export default function Today({ trip, onBack }) {
  const days = useMemo(() => docDays(trip), [trip]);
  const today = localToday();

  /* Open on the day you are having. Outside the trip there is no such day, so
     it opens at the start and says how far off that is. */
  const [at, setAt] = useState(() => {
    const i = days.indexOf(today);
    return i >= 0 ? i : 0;
  });
  const i = Math.min(Math.max(at, 0), Math.max(days.length - 1, 0));
  const iso = days[i];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") setAt((x) => Math.max(0, x - 1));
      if (e.key === "ArrowRight") setAt((x) => Math.min(days.length - 1, x + 1));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [days.length]);

  if (!days.length) {
    return (
      <div className="dayof">
        <div className="do-bar">
          <button className="do-back" onClick={onBack}>‹ Plan</button>
          <span className="do-trip">{trip.name}</span>
        </div>
        <div className="do-empty">Set the trip&rsquo;s dates and this fills in.</div>
      </div>
    );
  }

  const where = cityForDay(trip, iso) || {};
  const st = dayStay(trip, iso) || {};
  const base = dayBase(trip, iso);
  const day = (trip.days || {})[iso] || {};
  const items = day.items || [];

  /* Movement today, plus the red-eye that took off yesterday and lands now. */
  const legs = [
    ...travelOn(trip, iso),
    ...(i > 0 ? travelOn(trip, days[i - 1]).filter((L) => L.plusOne) : []),
  ];

  const away = days.indexOf(today) < 0 ? dayDiff(today, days[0]) : 0;

  return (
    <div className="dayof">
      <div className="do-bar">
        <button className="do-back" onClick={onBack}>‹ Plan</button>
        <span className="do-trip">{trip.name}</span>
        {days.indexOf(today) >= 0 && (
          <button className="do-now" disabled={iso === today}
            onClick={() => setAt(days.indexOf(today))}>Today</button>
        )}
      </div>

      <div className="do-nav">
        <button className="do-arrow" disabled={i === 0} aria-label="The day before"
          onClick={() => setAt(i - 1)}>‹</button>
        <div className="do-when">
          <div className="do-head">{headline(iso)}</div>
          <div className="do-n">
            Day {i + 1} of {days.length}
            {iso === today ? <span className="do-istoday">today</span> : null}
            {away > 0 && i === 0 ? <span className="do-away">in {away} day{away === 1 ? "" : "s"}</span> : null}
          </div>
        </div>
        <button className="do-arrow" disabled={i === days.length - 1} aria-label="The day after"
          onClick={() => setAt(i + 1)}>›</button>
      </div>

      {/* Where you are. On a travel day that is two places, and saying so
          plainly beats picking one of them and being wrong by half a day. */}
      <div className="do-where">
        {st.moves ? (
          <span>{st.wake} <span className="do-to">→</span> {st.sleep}</span>
        ) : (
          <span>{where.base || st.sleep || "—"}</span>
        )}
        {where.dayTrip && <span className="do-trip-to">day trip to {where.city}</span>}
      </div>

      {legs.map((L) => (
        <div key={L.id} className={`do-card do-leg${L.booked ? " ok" : ""}`}>
          <div className="do-card-main">
            <div className="do-card-title">
              <span aria-hidden="true">{KIND_GLYPH[L.kind] || "→"}</span> {L.from || "?"} → {L.to || "?"}
            </div>
            <div className="do-card-sub">
              {/* A red-eye is listed on the morning it lands, so its departure
                  time belongs to a day that is already over. Say so. */}
              {[L.date !== iso ? `left yesterday${L.depart ? ` ${to12h(L.depart)}` : ""}` : (L.depart ? `leaves ${to12h(L.depart)}` : ""),
                L.arrive ? `arrives ${to12h(L.arrive)}${L.plusOne && L.date === iso ? " next day" : ""}` : "",
                L.ref, L.booked ? "booked" : "not booked"].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="do-acts">
            {/* Where this leg touches you today: the gate you leave from, or
                the airport you have just walked out of. */}
            <Go href={legPlaceUrl(L, L.date === iso ? "from" : "to")}>Map</Go>
          </div>
        </div>
      ))}

      {base && (
        <div className="do-card do-bed">
          <div className="do-card-main">
            <div className="do-card-label">Tonight</div>
            <div className="do-card-title">{base.stay.name || base.seg.city}</div>
            <div className="do-card-sub">
              {[base.stay.address, base.stay.ref ? `conf. ${base.stay.ref}` : ""].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="do-acts">
            <Go href={stayUrl(trip, base.stay)}>Map</Go>
          </div>
        </div>
      )}

      {day.notes ? <p className="do-notes">{day.notes}</p> : null}

      {items.length === 0 ? (
        <div className="do-empty">Nothing planned. That is allowed.</div>
      ) : (
        <ul className="do-list">
          {items.map((it) => {
            const route = itemRoute(trip, iso, it);
            return (
              <li key={it.id} className={`do-item k-${it.kind}`}>
                <div className="do-time">{it.time ? to12h(it.time) : <span className="do-dot" aria-hidden="true">•</span>}</div>
                <div className="do-main">
                  <div className="do-title">{it.title || "—"}</div>
                  <div className="do-meta">
                    {it.kind}{it.cost ? ` · ${fmtMoney(it.cost, it.currency)}` : ""}
                    {it.place ? " · own place" : ""}
                  </div>
                  <div className="do-acts">
                    <Go href={itemUrl(trip, iso, it)}>Map</Go>
                    <Go href={route ? route.url : ""}>From hotel</Go>
                    <Go href={it.url} kind="ghost">Link</Go>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
