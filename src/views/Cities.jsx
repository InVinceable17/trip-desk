import React, { useState, useRef } from "react";
import { label as dayLabel } from "../flights.js";
import {
  tripDays, tripNights, assignedNights, segmentSpans, cityFlags,
  addSegment, moveSegment, segColor, bookedFlight,
  cityPlan, setDayTrip, isTransitStop,
} from "../model.js";
import { Btn, Card } from "../components/ui.jsx";

/* Phase 3. Ordered city segments, laid on the ribbon and draggable there.
   Each city locks independently: nights adding up is not the same as having
   decided, so the phase only reads as done once every city is locked. */

export default function Cities({ trip, update, readOnly }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [tripFor, setTripFor] = useState(null);   // segment id we're adding a day trip to
  const [tripDate, setTripDate] = useState("");
  const [tripCity, setTripCity] = useState("");
  const addRef = useRef(null);

  const days = tripDays(trip);
  const total = tripNights(trip);
  const got = assignedNights(trip.segments);
  const spans = segmentSpans(trip);
  const flags = cityFlags(trip);
  const booked = bookedFlight(trip);

  const setSegments = (next) =>
    update((t) => ({ ...t, segments: typeof next === "function" ? next(t.segments) : next }));

  const patch = (id, p) => setSegments((segs) => segs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = () => {
    if (!draft.trim()) return;
    setSegments((segs) => addSegment(segs, draft, total));
    setDraft("");
    // Keep the row open so a run of cities can be typed straight through.
    requestAnimationFrame(() => addRef.current && addRef.current.focus());
  };

  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) return;
    setSegments((segs) => moveSegment(
      segs,
      segs.findIndex((s) => s.id === dragId),
      segs.findIndex((s) => s.id === targetId),
    ));
    setDragId(null);
    setOverId(null);
  };

  const nudge = (i, dir) => setSegments((segs) => moveSegment(segs, i, i + dir));

  /* Which days belong to a stop — the choices for a day trip out of it. */
  const daysFor = (segId) => {
    const sp = spans.find((x) => x.seg.id === segId);
    if (!sp) return [];
    return tripDays(trip).slice(sp.startIdx, sp.startIdx + sp.nights);
  };

  const saveTrip = () => {
    if (!tripCity.trim() || !tripDate) return;
    update((t) => setDayTrip(t, tripDate, tripCity));
    setTripFor(null); setTripCity("");
  };

  /* A homebase stop: the row that owns nights and can be locked. */
  const renderBase = (row) => {
    const s = row.seg, i = row.i, span = row.span;
    /* A night in the air is a stop that owns a night but is not a place you
       arrive at. Saying "Arrive Oct 10" of it is not a small wording problem:
       when the stop is called something like "Overnight to Rome", the row
       reads as Rome starting a day earlier than the calendar above says. */
    const transit = isTransitStop(trip, s);
    return (
      <div
        key={s.id}
        className={`segrow${s.locked ? " locked" : ""}${dragId === s.id ? " dragging" : ""}${overId === s.id ? " dropover" : ""}`}
        draggable={!readOnly}
        onDragStart={(e) => { setDragId(s.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDragId(null); setOverId(null); }}
        onDragOver={(e) => { e.preventDefault(); if (overId !== s.id) setOverId(s.id); }}
        onDragLeave={() => setOverId((o) => (o === s.id ? null : o))}
        onDrop={(e) => { e.preventDefault(); onDrop(s.id); }}
      >
        <button
          className="drag" aria-label={`Reorder ${s.city || "this city"}. Use arrow up and down.`}
          disabled={readOnly}
          onKeyDown={(e) => {
            const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
            if (!dir) return;
            e.preventDefault();
            nudge(i, dir);
          }}
        >⠿</button>

        <span className="swatch-lg" style={{ background: segColor(i) }} aria-hidden="true" />

        <input className="segcity" value={s.city} disabled={readOnly || s.locked} placeholder="City"
          onChange={(e) => patch(s.id, { city: e.target.value })} />

        <div className="segnights">
          <Btn className="sm" disabled={readOnly || s.locked || s.nights <= 1}
            onClick={() => patch(s.id, { nights: s.nights - 1 })} aria-label="One night fewer">−</Btn>
          <span className="num">{s.nights}n</span>
          <Btn className="sm" disabled={readOnly || s.locked}
            onClick={() => patch(s.id, { nights: s.nights + 1 })} aria-label="One night more">+</Btn>
        </div>

        <span className="segdates">
          {!span ? <span className="muted">—</span>
            : transit ? (
              <span className="dpair">
                <i>In the air</i> {dayLabel(span.startDate)} → {dayLabel(span.endDate)}
              </span>
            ) : (
              <>
                <span className="dpair"><i>Arrive</i> {dayLabel(span.startDate)}</span>
                <span className="dpair"><i>Depart</i> {dayLabel(span.endDate)}</span>
              </>
            )}
        </span>

        <div className="grow" />

        {/* There is no day trip out of a plane. */}
        <Btn className="sm" disabled={readOnly || !span || transit}
          onClick={() => { setTripFor(s.id); setTripDate(daysFor(s.id)[0] || ""); setTripCity(""); setAdding(false); }}>
          + day trip
        </Btn>
        <Btn className="sm" kind={s.locked ? "solid" : "ghost"} disabled={readOnly}
          onClick={() => patch(s.id, { locked: !s.locked })} aria-pressed={s.locked}>
          {s.locked ? "Locked" : "Lock"}
        </Btn>
        <Btn className="sm" kind="danger" disabled={readOnly}
          onClick={() => setSegments((segs) => segs.filter((x) => x.id !== s.id))}
          aria-label={`Remove ${s.city || "this city"}`}>×</Btn>
      </div>
    );
  };

  const suggested = (trip.destAirports || "").split(/[,\s]+/).filter(Boolean).slice(0, 12);

  return (
    <div className="stack">
      {!trip.dates.locked && (
        <div className="banner warn">Lock your trip dates first.</div>
      )}

      <Card
        title="Cities"
        accent
        right={
          <span className={`nightcount${got === total && total ? " ok" : ""}`}>
            <b>{got}</b> of <b>{total}</b> nights
            {trip.segments.length > 0 && (
              <> · <b>{trip.segments.filter((s) => s.locked).length}</b> of <b>{trip.segments.length}</b> locked</>
            )}
          </span>
        }
      >
        {flags.length > 0 && (
          <div className="banner warn tight flags">{flags.map((f) => <span key={f}>{f}</span>)}</div>
        )}
        {booked && !flags.length && trip.segments.length > 0 && (
          <div className="banner good tight">
            Matches your flights — in {booked.out.to}, out {booked.ret.from}.
          </div>
        )}

        {!trip.segments.length && (
          <div className="empty">
            {days.length ? "Add your first city." : "Lock trip dates first."}
          </div>
        )}

        <div className="seglist">
          {cityPlan(trip).map((row) => (
            row.type === "trip"
              ? (
                <div key={`t${row.iso}`} className="segrow triprow">
                  <span className="drag placeholder" aria-hidden="true">↳</span>
                  <span className="swatch-lg ring" style={{ borderColor: row.color }} aria-hidden="true" />
                  <span className="tripcity">{row.city}</span>
                  <span className="chip k-ticket">day trip</span>
                  <span className="segdates"><span className="dpair"><i>On</i> {dayLabel(row.iso)}</span>
                    <span className="muted">out of {row.base}</span></span>
                  <div className="grow" />
                  <Btn className="sm" kind="danger" disabled={readOnly}
                    onClick={() => update((t) => setDayTrip(t, row.iso, ""))}
                    aria-label={`Remove the day trip to ${row.city}`}>×</Btn>
                </div>
              )
              : renderBase(row)
          ))}

          {/* Add sits at the end of the list, where the next city goes. */}
          {adding ? (
            <div className="segrow adding">
              <span className="drag placeholder" aria-hidden="true">+</span>
              <span className="swatch-lg ghost" aria-hidden="true" />
              <input
                ref={addRef} className="segcity" value={draft} list="destcities" autoFocus
                placeholder="City name" disabled={readOnly}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); add(); }
                  if (e.key === "Escape") { setAdding(false); setDraft(""); }
                }}
              />
              <Btn className="sm" kind="solid" onClick={add} disabled={readOnly || !draft.trim()}>Add stop</Btn>
              <Btn className="sm" onClick={() => { setAdding(false); setDraft(""); }}>Done</Btn>
            </div>
          ) : tripFor ? (
            <div className="segrow adding">
              <span className="drag placeholder" aria-hidden="true">↳</span>
              <span className="swatch-lg ghost" aria-hidden="true" />
              <input className="segcity" value={tripCity} list="destcities" autoFocus
                placeholder="Day trip to…" disabled={readOnly}
                onChange={(e) => setTripCity(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveTrip(); } }} />
              <select className="auto" value={tripDate} disabled={readOnly}
                onChange={(e) => setTripDate(e.target.value)}>
                {daysFor(tripFor).map((iso) => <option key={iso} value={iso}>{dayLabel(iso)}</option>)}
              </select>
              <Btn className="sm" kind="solid" onClick={saveTrip} disabled={readOnly || !tripCity.trim() || !tripDate}>Add day trip</Btn>
              <Btn className="sm" onClick={() => setTripFor(null)}>Cancel</Btn>
            </div>
          ) : (
            <div className="addrows">
              <button className="addrow" onClick={() => setAdding(true)} disabled={readOnly || !days.length}>
                <span className="plus" aria-hidden="true">+</span>
                <span>Add a stop</span>
              </button>
              <button className="addrow alt" disabled={readOnly || !spans.length}
                onClick={() => {
                  const first = spans[0];
                  setTripFor(first.seg.id);
                  setTripDate(daysFor(first.seg.id)[0] || "");
                  setTripCity("");
                }}>
                <span className="plus" aria-hidden="true">↳</span>
                <span>Add a day trip</span>
              </button>
            </div>
          )}
        </div>

        <datalist id="destcities">{suggested.map((a) => <option key={a} value={a} />)}</datalist>

        {total > 0 && got !== total && trip.segments.length > 0 && (
          <div className="row-wrap mt8">
            <Btn disabled={readOnly || trip.segments.some((s) => s.locked)}
              onClick={() => setSegments((segs) => balance(segs, total))}
              title={trip.segments.some((s) => s.locked) ? "Unlock every city first" : ""}>
              Even out to {total} nights
            </Btn>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Spread `total` nights across the segments as evenly as the order allows. */
function balance(segments, total) {
  if (!segments.length || !total) return segments;
  const base = Math.floor(total / segments.length);
  let extra = total - base * segments.length;
  return segments.map((s) => {
    const n = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    return { ...s, nights: Math.max(1, n) };
  });
}
