import React, { useState, useRef, useEffect } from "react";
import { label as dayLabel, dayOf, DOW } from "../flights.js";
import {
  tripDays, cityForDay, blankItem, blankDay, ITEM_KINDS, openBookings,
  segmentSpans, mapsSearch, lockedDayCount, dayStay, travelOn, KIND_GLYPH, fmtMoney,
} from "../model.js";
import { Btn, Card, Amount } from "../components/ui.jsx";

/* Phase 5. Every day open by default and notes that grow as you type, so the
   whole thing reads and behaves like one document you can run down. Each day
   locks on its own; the phase is only done when they all are. */

const KIND_LABEL = { idea: "idea", ticket: "ticket", reservation: "booking", tip: "tip" };

/** A textarea that grows to fit, so nothing scrolls inside a day. */
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
      ref={ref} className="daynotes" rows={1} value={value} disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => { onChange(e.target.value); fit(); }}
    />
  );
}

export default function Days({ trip, update, readOnly }) {
  const days = tripDays(trip);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [tripOpen, setTripOpen] = useState(() => new Set());
  const todo = openBookings(trip);
  const known = [...new Set(segmentSpans(trip).map((x) => x.seg.city).filter(Boolean))];
  const lockedCount = lockedDayCount(trip);

  if (!days.length) {
    return (
      <div className="stack">
        <div className="banner note">Lock your trip dates first.</div>
      </div>
    );
  }

  const setDay = (iso, fn) => update((t) => {
    const cur = t.days[iso] || blankDay();
    return { ...t, days: { ...t.days, [iso]: fn(cur) } };
  });

  const toggle = (iso) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(iso)) n.delete(iso); else n.add(iso);
    return n;
  });

  const setAll = (collapse) => setCollapsed(collapse ? new Set(days) : new Set());
  const lockAll = (v) => update((t) => {
    const next = { ...t.days };
    days.forEach((iso) => { next[iso] = { ...(next[iso] || blankDay()), locked: v }; });
    return { ...t, days: next };
  });

  return (
    <div className="stack">
      <div className="toolbar">
        <span className={`nightcount${lockedCount === days.length ? " ok" : ""}`}>
          <b>{lockedCount}</b> of <b>{days.length}</b> locked
        </span>
        <div className="grow" />
        <Btn className="sm" onClick={() => setAll(true)}>Collapse all</Btn>
        <Btn className="sm" onClick={() => setAll(false)}>Expand all</Btn>
        <Btn className="sm" disabled={readOnly} onClick={() => lockAll(lockedCount !== days.length)}>
          {lockedCount === days.length ? "Unlock all" : "Lock all"}
        </Btn>
      </div>

      {todo.length > 0 && (
        <Card title="Still to book" accent>
          <div className="todo">
            {todo.map((it) => (
              <div key={it.id} className="todo-row">
                <span className="muted num">{dayLabel(it.date)}</span>
                <span className={`chip k-${it.kind}`}>{KIND_LABEL[it.kind]}</span>
                <span className="todo-title">{it.title || "untitled"}</span>
                {it.cost && <span className="num muted">{fmtMoney(it.cost, it.currency)}</span>}
                {it.url && <a href={it.url} target="_blank" rel="noreferrer">open</a>}
                <div className="grow" />
                <Btn className="sm" disabled={readOnly} onClick={() => setDay(it.date, (d) => ({
                  ...d, items: d.items.map((x) => (x.id === it.id ? { ...x, done: true } : x)),
                }))}>Done</Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="daygrid doc">
        {days.map((iso, i) => {
          const where = cityForDay(trip, iso);
          const st = dayStay(trip, iso) || {};
          const moving = travelOn(trip, iso);
          const d = trip.days[iso] || blankDay();
          const open = !collapsed.has(iso);
          const last = i === days.length - 1;
          const editing = tripOpen.has(iso) || !!d.city;
          const locked = !!d.locked;

          return (
            <section key={iso} className={`day${open ? " open" : ""}${locked ? " locked" : ""}${st.moves ? " travel" : ""}`}
              style={where ? { borderLeftColor: where.color } : undefined}>
              {/* The whole strip toggles; the controls inside stop the bubble. */}
              <div className="day-head" role="button" tabIndex={0} aria-expanded={open}
                onClick={(e) => { if (!e.target.closest(".nostretch")) toggle(iso); }}
                onKeyDown={(e) => {
                  if (e.target.closest(".nostretch")) return;
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(iso); }
                }}>
                <span className="caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
                <span className="day-dow">{DOW[dayOf(iso)]}</span>
                <span className="day-date">{dayLabel(iso)}</span>

                {st.moves ? (
                  <span className="day-city travelpair">
                    <span style={{ color: st.wakeSeg ? undefined : undefined }}>{st.wake}</span>
                    <span className="arrow" aria-hidden="true">→</span>
                    <span>{st.sleep}</span>
                    <span className="chip k-ticket">travel day</span>
                  </span>
                ) : (
                  <span className="day-city" style={where ? { color: where.color } : undefined}>
                    {where ? where.base || "—" : "—"}
                  </span>
                )}

                {editing ? (
                  <span className="daytrip-edit nostretch">
                    <span className="arrow" aria-hidden="true">→</span>
                    <input
                      className="bare" list="knowncities" autoFocus={!d.city}
                      value={d.city || ""} disabled={readOnly || locked}
                      placeholder="day trip to…"
                      onChange={(e) => setDay(iso, (x) => ({ ...x, city: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Escape") { setDay(iso, (x) => ({ ...x, city: "" })); setTripOpen((s) => { const n = new Set(s); n.delete(iso); return n; }); } }}
                    />
                    <button className="linkbtn" disabled={readOnly || locked}
                      onClick={() => { setDay(iso, (x) => ({ ...x, city: "" })); setTripOpen((s) => { const n = new Set(s); n.delete(iso); return n; }); }}>
                      clear
                    </button>
                  </span>
                ) : (
                  <button className="linkbtn nostretch" disabled={readOnly || locked}
                    onClick={() => setTripOpen((s) => new Set(s).add(iso))}>
                    + day trip
                  </button>
                )}

                {moving.map((L) => (
                  <span key={L.id} className={`travelchip${L.booked ? " booked" : ""}`}
                    title={`${L.from} → ${L.to}${L.ref ? ` · ${L.ref}` : ""}${L.booked ? " · booked" : " · not booked"}`}>
                    <span aria-hidden="true">{KIND_GLYPH[L.kind] || "→"}</span>
                    {L.depart ? <span className="num">{L.depart}</span> : null}
                    <span>{L.ref || `${L.from}→${L.to}`}</span>
                    {L.cost ? <span className="num">{fmtMoney(L.cost, L.currency)}</span> : null}
                    {L.booked ? <span aria-hidden="true">✓</span> : null}
                  </span>
                ))}

                {i === 0 && <span className="chip">arrive</span>}
                {last && <span className="chip">depart</span>}

                <div className="grow" />
                {where && where.city && (
                  <a className="tiny nostretch" href={mapsSearch(`things to do in ${where.city}`)} target="_blank" rel="noreferrer">maps ↗</a>
                )}
                {d.items.length > 0 && <span className="muted num">{d.items.length}</span>}
                <span className="nostretch">
                  <Btn className="sm" kind={locked ? "solid" : "ghost"} disabled={readOnly}
                    onClick={() => setDay(iso, (x) => ({ ...x, locked: !x.locked }))} aria-pressed={locked}>
                    {locked ? "Locked" : "Lock"}
                  </Btn>
                </span>
              </div>

              {open && (
                <div className="day-body">
                  <Notes
                    value={d.notes} disabled={readOnly || locked}
                    placeholder="Notes for the day…"
                    onChange={(v) => setDay(iso, (x) => ({ ...x, notes: v }))}
                  />

                  {d.items.map((it) => (
                    <div key={it.id} className="item">
                      <input type="checkbox" checked={it.done} disabled={readOnly || locked} aria-label="Done"
                        onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, done: e.target.checked } : y)) }))} />
                      <select value={it.kind} disabled={readOnly || locked} className="kindpick"
                        onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, kind: e.target.value } : y)) }))}>
                        {ITEM_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                      </select>
                      <input className={`bare grow${it.done ? " struck" : ""}`} value={it.title} disabled={readOnly || locked} placeholder="What is it?"
                        onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, title: e.target.value } : y)) }))} />
                      <input className="bare time" value={it.time} disabled={readOnly || locked} placeholder="time"
                        onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, time: e.target.value } : y)) }))} />
                      <Amount bare value={it.cost} currency={it.currency} disabled={readOnly || locked}
                        placeholder="cost"
                        onChange={({ value, currency }) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, cost: value, currency } : y)) }))} />
                      <input className="bare url" value={it.url} disabled={readOnly || locked} placeholder="link"
                        onChange={(e) => setDay(iso, (x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, url: e.target.value } : y)) }))} />
                      {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="tiny">↗</a>}
                      <Btn className="sm" kind="danger" disabled={readOnly || locked}
                        onClick={() => setDay(iso, (x) => ({ ...x, items: x.items.filter((y) => y.id !== it.id) }))}>×</Btn>
                    </div>
                  ))}

                  {!locked && (
                    <div className="row-wrap additems">
                      {ITEM_KINDS.map((k) => (
                        <Btn key={k} className="sm" disabled={readOnly}
                          onClick={() => setDay(iso, (x) => ({ ...x, items: [...x.items, blankItem(k)] }))}>
                          + {KIND_LABEL[k]}
                        </Btn>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <datalist id="knowncities">{known.map((c) => <option key={c} value={c} />)}</datalist>
    </div>
  );
}
