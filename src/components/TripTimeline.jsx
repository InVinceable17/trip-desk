import React, { useState } from "react";
import { range, label as dayLabel, to12h, showDur, parseDur } from "../flights.js";
import {
  tripDays, tripNights, segmentSpans, segColor, leadStay, cityForDay,
  travelLegs, dayTrips, travelDays, dayStay, travelOn, KIND_GLYPH, fmtMoney,
  blankDay, openBookings, nightsBetween,
} from "../model.js";
import Timeline from "./Timeline.jsx";


/* ============================================================================
   TripTimeline — the trip's spine, above the phase stepper.

   Layers appear as each phase produces something, in the order they matter
   when you look down a day:

     Trip     the dates themselves
     Travel   discrete movements — each flight, train or ferry on its own day
     Hotels   where you sleep, which outlasts where you go
     Cities   the stop each night belongs to, with day trips riding on top
     Days     what is planned

   Travel and Hotels are clickable; the detail opens under the calendar.
   ========================================================================== */

export default function TripTimeline({ trip, phase, update, readOnly }) {
  const [sel, setSel] = useState(null); // {type:"travel"|"hotel", id}

  const locked = trip.dates.locked && trip.dates.start && trip.dates.end;
  const onDates = phase === "dates";

  const useWindow = onDates || !locked;
  const days = useWindow
    ? range(trip.window.start || trip.dates.start, trip.window.end || trip.dates.end)
    : tripDays(trip);

  if (!days.length) {
    return (
      <section className="ribbon card">
        <div className="tl-empty">Set a date window in <b>Dates</b>.</div>
      </section>
    );
  }

  const idx = (iso) => days.indexOf(iso);
  const origin = useWindow ? Math.max(0, idx(trip.dates.start)) : 0;
  const layers = [];
  const pick = (type, id) => setSel((s) => (s && s.type === type && s.id === id ? null : { type, id }));

  /* ---- 1. the trip itself ------------------------------------------------ */
  if (onDates && !locked && !readOnly) {
    layers.push({
      key: "pick", kind: "pick", label: "Trip", active: true,
      value: { start: trip.dates.start, end: trip.dates.end },
      onChange: (v) => update((t) => ({ ...t, dates: { ...t.dates, ...v } })),
    });
  } else if (trip.dates.start && trip.dates.end) {
    const a = idx(trip.dates.start), b = idx(trip.dates.end);
    layers.push({
      key: "span", kind: "bars", label: "Trip", active: onDates,
      bars: [{
        key: "trip", startIdx: a, endIdx: b, tone: locked ? "locked" : "draft",
        left: dayLabel(trip.dates.start).replace(/^\w+ /, ""),
        right: dayLabel(trip.dates.end).replace(/^\w+ /, ""),
        mid: `${tripNights(trip)} nights${locked ? "" : " · not locked"}`,
        title: locked ? "Locked trip dates" : "Draft dates — lock them in Dates",
      }],
      note: a < 0 || b < 0 ? "trip dates sit outside this window" : null,
    });
  }

  /* ---- 2. travel — one point per movement -------------------------------- */
  const legs = travelLegs(trip);
  if (legs.length) {
    layers.push({
      key: "travel", kind: "points", label: "Travel", active: phase === "flights",
      offCount: legs.filter((L) => idx(L.date) < 0).length,
      points: legs.map((L) => {
        // A leg outside the shown range is pinned to the nearest edge rather
        // than dropped — a flight that disagrees with your dates is exactly
        // the thing you need to see.
        const at = idx(L.date);
        const off = at < 0;
        const pinned = off ? (L.date < days[0] ? 0 : days.length - 1) : at;
        return {
          key: L.id,
          idx: pinned,
          off,
          glyph: KIND_GLYPH[L.kind] || "→",
          label: `${L.from || "?"}→${L.to || "?"}`,
          tone: [L.booked ? "booked" : "", off ? "off" : ""].filter(Boolean).join(" "),
          selected: !!(sel && sel.type === "travel" && sel.id === L.id),
          title: off
            ? `${dayLabel(L.date)} — outside the trip dates · ${L.from}→${L.to}`
            : `${dayLabel(L.date)} · ${L.from}→${L.to}${L.depart ? ` at ${to12h(L.depart)}` : ""}`,
          onClick: () => pick("travel", L.id),
        };
      }),
    });
  }

  /* ---- 3. hotels --------------------------------------------------------- */
  const spans = segmentSpans(trip);
  if ((trip.stays || []).length) {
    const bars = spans.map(({ seg, startIdx, nights }) => {
      const s = leadStay(trip, seg.id);
      if (!s) return null;
      return {
        key: seg.id,
        startIdx: origin + startIdx,
        endIdx: origin + startIdx + nights - 1,
        half: true,   // check in during the day, check out during the day
        tone: s.status === "Booked" ? "booked" : "maybe",
        left: seg.city || "—",
        mid: (s.name || "unnamed").slice(0, 26),
        right: s.status === "Booked" ? "✓" : "?",
        title: `${seg.city || "unnamed city"} — ${s.name || "unnamed"} (${s.status})`,
        selected: !!(sel && sel.type === "hotel" && sel.id === s.id),
        onClick: () => pick("hotel", s.id),
      };
    }).filter(Boolean);
    if (bars.length) layers.push({ key: "hotels", kind: "bars", label: "Hotels", active: phase === "stays", bars });
  }

  /* ---- 4. cities, with day trips riding on top --------------------------- */
  const segs = trip.segments || [];
  if (segs.length) {
    layers.push({
      key: "cities", kind: "segments", label: "Cities", active: phase === "cities",
      origin,
      segments: segs.map((s, i) => ({ ...s, color: segColor(i) })),
      trips: dayTrips(trip).map((d) => ({ ...d, idx: idx(d.iso) })),
      moves: travelDays(trip).map((d) => ({ ...d, idx: idx(d.iso) })),
      onPick: (id) => pick("city", id),
      selectedId: sel && sel.type === "city" ? sel.id : null,
      readOnly: readOnly || phase !== "cities",
      onChange: (next) => update((t) => ({
        ...t, segments: next.map(({ color, ...rest }) => rest),
      })),
    });
  }

  /* ---- 5. days ----------------------------------------------------------- */
  const dayEntries = Object.entries(trip.days || {})
    .filter(([, d]) => d && ((d.items || []).length || d.notes || d.city || d.locked));
  if (dayEntries.length || (locked && segs.length)) {
    const marks = {};
    dayEntries.forEach(([iso, d]) => {
      const at = idx(iso);
      if (at < 0) return;
      const n = (d.items || []).length;
      const open = (d.items || []).filter((i) => !i.done && (i.kind === "ticket" || i.kind === "reservation")).length;
      const where = cityForDay(trip, iso);
      marks[at] = {
        n: n || "•",
        trip: !!(where && where.dayTrip),
        locked: !!d.locked,
        title: [
          where && where.dayTrip ? `Day trip to ${where.city}` : null,
          `${n} item${n === 1 ? "" : "s"}`,
          open ? `${open} still to book` : null,
          d.locked ? "locked" : null,
        ].filter(Boolean).join(" — "),
      };
    });
    layers.push({
      key: "days", kind: "ticks", label: "Days", active: phase === "days", marks,
      onPick: (iso) => pick("day", iso),
      selectedIso: sel && sel.type === "day" ? sel.id : null,
    });
  }

  const hint = onDates && !locked && !readOnly
    ? "click a day to set the start, then another to set the end"
    : phase === "cities" && segs.length
      ? "drag a city's right edge to move nights"
      : "";

  return (
    <section className="ribbon card">
      <Timeline
        days={days}
        layers={layers}
        onPickDay={(iso) => pick("day", iso)}
        selectedDay={sel && sel.type === "day" ? sel.id : null}
        holidays={new Set(trip.holidays || [])}
        offRange={useWindow && locked ? { start: trip.dates.start, end: trip.dates.end } : null}
        compact
        footer={hint ? <span className="hintline">{hint}</span> : null}
      />
      {sel && <Detail trip={trip} sel={sel} onClose={() => setSel(null)} />}
    </section>
  );
}

/* --------------------------------------------------------------- detail */

function Detail({ trip, sel, onClose }) {
  if (sel.type === "city") return <CityDetail trip={trip} id={sel.id} onClose={onClose} />;
  if (sel.type === "day") return <DayDetail trip={trip} iso={sel.id} onClose={onClose} />;
  return <LineDetail trip={trip} sel={sel} onClose={onClose} />;
}

function Shell({ glyph, title, chip, onClose, children }) {
  return (
    <div className="tl-detail">
      <div className="det-head">
        <span className="det-glyph" aria-hidden="true">{glyph}</span>
        <span className="det-title">{title}</span>
        {chip && <span className={`chip${/^booked$/i.test(chip) ? " st-booked" : ""}`}>{chip}</span>}
        <div className="grow" />
        <button className="det-close" onClick={onClose} aria-label="Close details">×</button>
      </div>
      {children}
    </div>
  );
}

/** A stop: its dates, and what is planned across the days it covers. */
function CityDetail({ trip, id, onClose }) {
  const span = segmentSpans(trip).find((x) => x.seg.id === id);
  if (!span) return null;
  const stay = leadStay(trip, id);
  const days = tripDays(trip).slice(span.startIdx, span.startIdx + span.nights);
  const items = days.flatMap((iso) => ((trip.days[iso] || {}).items || []).map((it) => ({ ...it, iso })));
  const notes = days
    .map((iso) => [iso, (trip.days[iso] || {}).notes])
    .filter(([, n]) => n && n.trim());

  return (
    <Shell glyph="◍" title={span.seg.city || "unnamed stop"}
      chip={span.seg.locked ? "locked" : null} onClose={onClose}>
      <dl className="det-rows">
        <dt>Arrive</dt><dd>{dayLabel(span.startDate)}</dd>
        <dt>Depart</dt><dd>{dayLabel(span.endDate)} · {span.nights} night{span.nights === 1 ? "" : "s"}</dd>
        {stay && <><dt>Hotel</dt><dd>{stay.name || "unnamed"} · {fmtMoney(stay.total, stay.currency)} {stay.status.toLowerCase()}</dd></>}
      </dl>

      {notes.length > 0 && (
        <div className="det-block">
          <div className="lbl">Notes</div>
          {notes.map(([iso, n]) => (
            <p key={iso} className="det-note"><b>{dayLabel(iso).replace(/^\w+ /, "")}</b> {n}</p>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="det-block">
          <div className="lbl">Plans · {items.length}</div>
          <ul className="det-list">
            {items.map((it) => (
              <li key={it.id} className={it.done ? "done" : ""}>
                <span className="muted num">{dayLabel(it.iso).replace(/^\w+ /, "")}</span>
                <span>{it.title || it.kind}</span>
                {it.cost && <span className="muted num">{fmtMoney(it.cost, it.currency)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!notes.length && !items.length && <p className="hint">Nothing planned in {span.seg.city} yet.</p>}
    </Shell>
  );
}

/** A day: where you are, what moves, and what you have planned. */
function DayDetail({ trip, iso, onClose }) {
  const d = trip.days[iso] || blankDay();
  const st = dayStay(trip, iso) || {};
  const where = cityForDay(trip, iso);
  const moving = travelOn(trip, iso);
  const days = tripDays(trip);
  const n = days.indexOf(iso);

  // Where you sleep tonight, and — on a travel day — where you slept last night.
  const bed = st.sleepSeg ? leadStay(trip, st.sleepSeg.id) : null;
  const lastBed = st.moves && st.wakeSeg ? leadStay(trip, st.wakeSeg.id) : null;

  return (
    <Shell glyph="◷" title={dayLabel(iso)}
      chip={d.locked ? "locked" : st.moves ? "travel day" : st.arrival ? "arrive" : st.departure ? "depart" : null}
      onClose={onClose}>
      <dl className="det-rows">
        <dt>Day</dt>
        <dd>
          {n + 1} of {days.length}
          {where && where.dayTrip
            ? <span className="muted">· day trip to {where.city}, sleeping in {where.base}</span>
            : null}
        </dd>

        {st.moves
          ? <><dt>Cities</dt><dd>wake in <b>{st.wake}</b> <span className="muted">→</span> sleep in <b>{st.sleep}</b></dd></>
          : <><dt>City</dt><dd>{where ? where.city || "—" : "—"}</dd></>}

        {moving.map((L) => (
          <React.Fragment key={L.id}>
            <dt>{L.kind}</dt>
            <dd>
              <span aria-hidden="true">{KIND_GLYPH[L.kind] || "→"}</span>
              {L.from} → {L.to}
              {L.depart ? ` · ${to12h(L.depart)}` : ""}
              {L.arrive ? ` → ${to12h(L.arrive)}${L.plusOne ? " +1" : ""}` : ""}
              {L.ref ? ` · ${L.ref}` : ""}
              {L.cost ? ` · ${fmtMoney(L.cost, L.currency)}` : ""}
              {L.booked
                ? <span className="chip st-booked">{L.bookingRef ? `conf. ${L.bookingRef}` : "booked"}</span>
                : <span className="chip">not booked</span>}
              {L.url && <a href={L.url} target="_blank" rel="noreferrer">open ↗</a>}
            </dd>
          </React.Fragment>
        ))}

        {lastBed && (
          <><dt>Check out</dt>
            <dd>{lastBed.name || "unnamed"} <span className="muted">in {st.wake}</span></dd></>
        )}
        {bed && (
          <><dt>{lastBed ? "Check in" : "Hotel"}</dt>
            <dd>
              {bed.name || "unnamed"}
              <span className="muted">
                {st.sleepSeg ? `in ${st.sleepSeg.city}` : ""} · {fmtMoney(bed.total, bed.currency)} for the stay
              </span>
              <span className={`chip${bed.status === "Booked" ? " st-booked" : ""}`}>{bed.status.toLowerCase()}</span>
              {bed.url && <a href={bed.url} target="_blank" rel="noreferrer">open ↗</a>}
            </dd></>
        )}
        {!bed && st.departure && <><dt>Tonight</dt><dd className="muted">flying home</dd></>}
      </dl>

      {d.notes && <div className="det-block"><div className="lbl">Notes</div><p className="det-note">{d.notes}</p></div>}

      {(d.items || []).length > 0 && (
        <div className="det-block">
          <div className="lbl">Activities · {d.items.length}</div>
          <ul className="det-list">
            {d.items.map((it) => (
              <li key={it.id} className={it.done ? "done" : ""}>
                {it.time && <span className="muted num">{it.time}</span>}
                <span className={`chip k-${it.kind}`}>{it.kind}</span>
                <span>{it.title || "untitled"}</span>
                {it.cost && <span className="muted num">{fmtMoney(it.cost, it.currency)}</span>}
                {it.url && <a href={it.url} target="_blank" rel="noreferrer">open ↗</a>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!d.notes && !(d.items || []).length && (
        <p className="hint">No notes or activities on this day yet — add them in <b>Days</b>.</p>
      )}
    </Shell>
  );
}

function LineDetail({ trip, sel, onClose }) {
  const rows = [];
  let title = "", glyph = "", chip = null;

  if (sel.type === "travel") {
    const L = travelLegs(trip).find((x) => x.id === sel.id);
    if (!L) return null;
    title = `${L.from || "?"} → ${L.to || "?"}`;
    glyph = KIND_GLYPH[L.kind] || "→";
    chip = L.booked ? "booked" : null;
    rows.push(["When", `${dayLabel(L.date)}${L.depart ? ` · ${to12h(L.depart)}` : ""}${L.arrive ? ` → ${to12h(L.arrive)}${L.plusOne ? " +1" : ""}` : ""}`]);
    if (L.dur) rows.push(["Duration", showDur(parseDur(L.dur))]);
    if (L.stops) rows.push(["Stops", L.stops]);
    if (L.carrier || L.ref) rows.push([L.kind === "flight" ? "Flight" : "Service", [L.carrier, L.ref].filter(Boolean).join(" · ")]);
    if (L.name && L.source === "flight") rows.push(["Option", L.name]);
    if (L.cost) rows.push(["Cost", fmtMoney(L.cost, L.currency)]);
    if (L.bookingRef) rows.push(["Confirmation", L.bookingRef]);
    if (L.url) rows.push(["Link", <a key="l" href={L.url} target="_blank" rel="noreferrer">open ↗</a>]);
    if (L.notes) rows.push(["Notes", L.notes]);
  } else {
    const s = (trip.stays || []).find((x) => x.id === sel.id);
    if (!s) return null;
    const seg = (trip.segments || []).find((x) => x.id === s.segmentId);
    const span = segmentSpans(trip).find((x) => x.seg.id === s.segmentId);
    title = s.name || "unnamed place";
    glyph = "⌂";
    chip = s.status;
    if (seg) rows.push(["City", seg.city || "—"]);
    if (span) rows.push(["Nights", `${dayLabel(span.startDate)} → ${dayLabel(span.endDate)} · ${span.nights}`]);
    if (s.total) rows.push(["Total", fmtMoney(s.total, s.currency)]);
    if (s.ref) rows.push(["Confirmation", s.ref]);
    if (s.notes) rows.push(["Notes", s.notes]);
    if (s.url) rows.push(["Link", <a key="l" href={s.url} target="_blank" rel="noreferrer">open ↗</a>]);
  }

  return (
    <Shell glyph={glyph} title={title} chip={chip} onClose={onClose}>
      <dl className="det-rows">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt><dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
    </Shell>
  );
}
