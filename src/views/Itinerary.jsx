import React, { useRef, useEffect, useState } from "react";
import { label as dayLabel } from "../flights.js";
import {
  tripDays, cityForDay, blankItem, blankDay, ITEM_KINDS,
  segmentSpans, dayStay, travelOn, KIND_GLYPH, fmtMoney, leadStay, lockedDayCount,
} from "../model.js";
import { Btn, Amount } from "../components/ui.jsx";

/* ============================================================================
   Itinerary — the trip as one document, always on screen.

   This is the left column, and it is the answer to "what is this trip". It
   reads like something written in a word processor: dates as headings, prose
   that flows, no card borders, nothing to expand. What it is NOT is a text
   buffer. Every keystroke still lands in a typed field — `days[iso].notes`,
   an item's title, a day-trip city — because the moment prose becomes the
   store, ids stop being stable and a renamed hotel is indistinguishable from
   a replaced one. That lesson is already paid for in doc-sync.js; this view
   does not re-learn it.

   Everything above the notes is derived and read-only here: which city you
   sleep in, which bed, what moves that day. Clicking any of it opens the
   panel that owns it, so the document doubles as navigation.

   It should read as one continuous page of text, not a stack of rows. No
   rules between days, no chips, no visible controls — the day heading, the
   facts under it and the prose are all just lines. Anything you can operate
   stays invisible until the pointer is on the day it belongs to.
   ========================================================================== */

const KIND_LABEL = { idea: "idea", ticket: "ticket", reservation: "booking", tip: "tip" };

/** A textarea that grows to fit, so the page scrolls and the field never does. */
function Notes({ value, onChange, disabled, placeholder }) {
  const ref = useRef(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(fit, [value]);
  return (
    <textarea
      ref={ref} className="docnotes" rows={1} value={value} disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => { onChange(e.target.value); fit(); }}
    />
  );
}

export default function Itinerary({ trip, update, readOnly, onGo }) {
  const days = tripDays(trip);
  const [tripOpen, setTripOpen] = useState(() => new Set());
  const known = [...new Set(segmentSpans(trip).map((x) => x.seg.city).filter(Boolean))];

  const setDay = (iso, fn) => update((t) => {
    const cur = t.days[iso] || blankDay();
    return { ...t, days: { ...t.days, [iso]: fn(cur) } };
  });

  if (!days.length) {
    return (
      <article className="doc">
        <p className="doc-blank">
          The itinerary writes itself once the trip has dates.{" "}
          <button className="linkbtn" onClick={() => onGo("dates")}>Set them</button>
        </p>
      </article>
    );
  }

  const lockedCount = lockedDayCount(trip);
  const allLocked = lockedCount === days.length;
  const lockAll = (v) => update((t) => {
    const next = { ...t.days };
    days.forEach((iso) => { next[iso] = { ...(next[iso] || blankDay()), locked: v }; });
    return { ...t, days: next };
  });

  return (
    <article className="doc">
      {/* The one piece of document-level chrome. Locking eleven days one at a
          time is not editing, it is clicking. */}
      <div className="doc-top">
        <span className={`nightcount${allLocked ? " ok" : ""}`}>
          <b>{lockedCount}</b> of <b>{days.length}</b> locked
        </span>
        <span className="grow" />
        <button className="linkbtn" disabled={readOnly} onClick={() => lockAll(!allLocked)}>
          {allLocked ? "Unlock all" : "Lock all"}
        </button>
      </div>

      {days.map((iso, i) => {
        const where = cityForDay(trip, iso);
        const st = dayStay(trip, iso) || {};
        const moving = travelOn(trip, iso);
        const d = trip.days[iso] || blankDay();
        const last = i === days.length - 1;
        const editing = tripOpen.has(iso) || !!d.city;
        const locked = !!d.locked;
        const bed = st.sleepSeg ? leadStay(trip, st.sleepSeg.id) : null;

        return (
          <section key={iso} id={`d-${iso}`}
            className={`docday${locked ? " locked" : ""}${st.moves ? " moving" : ""}`}
            style={where ? { "--dayhue": where.color } : undefined}>

            <h3 className="docday-head">
              <span className="docday-date">{dayLabel(iso)}</span>

              {st.moves ? (
                <button className="docday-where" onClick={() => onGo("cities")}>
                  {st.wake} <span className="arrow" aria-hidden="true">→</span> {st.sleep}
                </button>
              ) : (
                <button className="docday-where" onClick={() => onGo("cities")}>
                  {where ? where.base || "—" : "—"}
                </button>
              )}

              {editing ? (
                <span className="docday-trip">
                  <span className="arrow" aria-hidden="true">→</span>
                  <input
                    className="bare" list="knowncities" autoFocus={!d.city}
                    value={d.city || ""} disabled={readOnly || locked}
                    placeholder="day trip to…"
                    onChange={(e) => setDay(iso, (x) => ({ ...x, city: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key !== "Escape") return;
                      setDay(iso, (x) => ({ ...x, city: "" }));
                      setTripOpen((s) => { const n = new Set(s); n.delete(iso); return n; });
                    }}
                  />
                </span>
              ) : null}

              {i === 0 && <span className="docday-edge">arrive</span>}
              {last && <span className="docday-edge">depart</span>}

              <span className="grow" />

              <span className="docday-acts">
                {!editing && (
                  <button className="linkbtn" disabled={readOnly || locked}
                    onClick={() => setTripOpen((s) => new Set(s).add(iso))}>day trip</button>
                )}
                <button className={`linkbtn${locked ? " on" : ""}`} disabled={readOnly}
                  aria-pressed={locked}
                  onClick={() => setDay(iso, (x) => ({ ...x, locked: !x.locked }))}>
                  {locked ? "locked" : "lock"}
                </button>
              </span>
            </h3>

            {/* Derived context: where you sleep, and what moves. Read-only here
                — each piece opens the panel that actually owns it. */}
            {(bed || moving.length > 0) && (
              <p className="docday-ctx">
                {bed && (
                  <button className="ctxbit" onClick={() => onGo("stays")}>
                    {bed.name || "unnamed place"}
                    {bed.status !== "Booked" && <i>{bed.status.toLowerCase()}</i>}
                  </button>
                )}
                {moving.map((L) => (
                  <button key={L.id} className={`ctxbit${L.booked ? " booked" : ""}`}
                    onClick={() => onGo("flights")}>
                    <span aria-hidden="true">{KIND_GLYPH[L.kind] || "→"}</span>
                    {L.depart ? `${L.depart} ` : ""}
                    {L.ref || `${L.from}→${L.to}`}
                    {L.cost ? ` ${fmtMoney(L.cost, L.currency)}` : ""}
                    {!L.booked && <i>not booked</i>}
                  </button>
                ))}
              </p>
            )}

            <Notes
              value={d.notes} disabled={readOnly || locked}
              placeholder="Write the day…"
              onChange={(v) => setDay(iso, (x) => ({ ...x, notes: v }))}
            />

            {d.items.map((it) => (
              <div key={it.id} className={`docitem${it.done ? " done" : ""}`}>
                <input type="checkbox" checked={it.done} disabled={readOnly || locked} aria-label="Done"
                  onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, done: e.target.checked } : y)) }))} />
                <input className="bare time" value={it.time} disabled={readOnly || locked} placeholder=""
                  onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, time: e.target.value } : y)) }))} />
                <input className="bare grow" value={it.title} disabled={readOnly || locked} placeholder="What is it?"
                  onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, title: e.target.value } : y)) }))} />
                <Amount bare value={it.cost} currency={it.currency} disabled={readOnly || locked}
                  placeholder=""
                  onChange={({ value, currency }) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, cost: value, currency } : y)) }))} />
                {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="tiny">↗</a>}
                <span className="docitem-more">
                  <select value={it.kind} disabled={readOnly || locked} className="kindpick"
                    onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, kind: e.target.value } : y)) }))}>
                    {ITEM_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                  <input className="bare url" value={it.url} disabled={readOnly || locked} placeholder="link"
                    onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, url: e.target.value } : y)) }))} />
                  <Btn className="sm" kind="danger" disabled={readOnly || locked}
                    onClick={() => setDay(iso, (x) => ({ ...x, items: x.items.filter((y) => y.id !== it.id) }))}>×</Btn>
                </span>
              </div>
            ))}

            {/* One way in, not four. The kind is a dropdown on the row itself,
                so asking for it up front only makes the add a decision. */}
            {!locked && !readOnly && (
              <div className="docday-add">
                <button className="linkbtn"
                  onClick={() => setDay(iso, (x) => ({ ...x, items: [...x.items, blankItem("idea")] }))}>
                  + add
                </button>
              </div>
            )}
          </section>
        );
      })}

      <datalist id="knowncities">{known.map((c) => <option key={c} value={c} />)}</datalist>
    </article>
  );
}
