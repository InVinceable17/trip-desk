import React, { useRef, useState, useLayoutEffect, useCallback } from "react";
import { DOW, MON, dayOf, label as dayLabel } from "../flights.js";
import { moveBoundary, resizeLast } from "../model.js";

/* ============================================================================
   Timeline — the primitive. A day header plus a stack of layer rows.

   It knows nothing about trips; TripTimeline.jsx decides which layers exist.
   The label gutter is a fixed pixel width so drag maths can convert an x
   coordinate to day columns without measuring two elements.
   ========================================================================== */

export const LABEL_W = 120;

/* Each day is TWO grid columns, so a bar can stop at midday. You arrive in a
   city during the day and leave it during the day, so a stop runs from the
   middle of its arrival day to the middle of its departure day — which makes a
   travel day read as half the old city and half the new one, and makes
   consecutive stops tile exactly. */
const H = 2;
const colsFor = (n) => `${LABEL_W}px repeat(${Math.max(n, 1) * H}, 1fr)`;
const colStart = (i) => 2 + i * H;        // grid line at the start of day i
const colMid = (i) => 2 + i * H + 1;      // grid line at midday of day i
const colEnd = (i) => 2 + (i + 1) * H;    // grid line at the end of day i
const wholeDay = (i) => `${colStart(i)} / ${colEnd(i)}`;

/* ------------------------------------------------------------------ header */

/** Weeks start on Sunday; the first column always starts one. */
export const isWeekStart = (iso, i) => i === 0 || dayOf(iso) === 0;

/** Consecutive runs of days sharing a month, for the month caption row. */
function monthRuns(days) {
  const runs = [];
  days.forEach((d, i) => {
    const m = +d.slice(5, 7);
    const y = d.slice(0, 4);
    const last = runs[runs.length - 1];
    if (last && last.m === m && last.y === y) last.len++;
    else runs.push({ m, y, start: i, len: 1 });
  });
  return runs;
}

function MonthRow({ days }) {
  const runs = monthRuns(days);
  const multiYear = new Set(runs.map((r) => r.y)).size > 1;
  return (
    <>
      <div className="tl-gutter" />
      {runs.map((r) => (
        <div key={`${r.y}-${r.m}`} className="tl-month"
          style={{ gridColumn: `${colStart(r.start)} / ${colStart(r.start + r.len)}` }}>
          <span>{MON[r.m]}{multiYear ? ` ’${r.y.slice(2)}` : ""}</span>
        </div>
      ))}
    </>
  );
}

function DayHeader({ days, holidays, inRange, onPickDay, selectedDay }) {
  return (
    <>
      <div className="tl-gutter" />
      {days.map((d, i) => {
        const wknd = dayOf(d) === 0 || dayOf(d) === 6;
        const cls = `tl-day${inRange && inRange(d) ? " in" : ""}${isWeekStart(d, i) ? " weekstart" : ""}`
          + `${onPickDay ? " pickable" : ""}${selectedDay === d ? " selected" : ""}`;
        const body = (
          <>
            <div className={wknd ? "dow wknd" : "dow"}>{DOW[dayOf(d)]}</div>
            <div className="dom">{+d.slice(-2)}</div>
            {holidays && holidays.has(d) && <div className="hol" title="Holiday" />}
          </>
        );
        return onPickDay ? (
          <button key={d} type="button" style={{ gridColumn: wholeDay(i) }} className={cls}
            onClick={() => onPickDay(d)} title={`Everything on ${dayLabel(d)}`}>
            {body}
          </button>
        ) : (
          <div key={d} style={{ gridColumn: wholeDay(i) }} className={cls}>{body}</div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------- layer: day picker */

function PickLayer({ days, value, onChange }) {
  const [hover, setHover] = useState(null);
  const { start, end } = value;

  const click = (d) => {
    if (!start || (start && end)) return onChange({ start: d, end: "" });
    if (d < start) return onChange({ start: d, end: "" });
    onChange({ start, end: d });
  };

  const previewEnd = end || (start && hover && hover >= start ? hover : "");
  const inSpan = (d) => start && previewEnd && d >= start && d <= previewEnd;

  return days.map((d, i) => {
    const isStart = d === start, isEnd = d === end;
    return (
      <button
        key={d}
        style={{ gridColumn: wholeDay(i) }}
        className={`tl-pick${inSpan(d) ? " in" : ""}${isStart ? " start" : ""}${isEnd ? " end" : ""}`}
        onClick={() => click(d)}
        onMouseEnter={() => setHover(d)}
        onMouseLeave={() => setHover(null)}
        aria-label={`${dayLabel(d)}${isStart ? " — trip starts" : isEnd ? " — trip ends" : ""}`}
        aria-pressed={isStart || isEnd}
      />
    );
  });
}

/* --------------------------------------------------------- layer: segments */

function SegmentLayer({ days, segments, origin, onChange, readOnly, colW, trips, moves, onPick, selectedId }) {
  const drag = useRef(null);

  const onPointerDown = (e, i, kind) => {
    if (readOnly) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { i, kind, x0: e.clientX, base: segments };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || !colW) return;
    const delta = Math.round((e.clientX - d.x0) / colW);
    onChange(!delta ? d.base : d.kind === "end" ? resizeLast(d.base, delta) : moveBoundary(d.base, d.i, delta));
  };
  const onPointerUp = (e) => {
    if (!drag.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    drag.current = null;
  };
  const key = (e, i, kind) => {
    if (readOnly) return;
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    onChange(kind === "end" ? resizeLast(segments, step) : moveBoundary(segments, i, step));
  };

  let at = origin;
  const spans = segments.map((s, i) => {
    const n = Math.max(0, +s.nights || 0);
    const span = { s, i, start: at, nights: n };
    at += n;
    return span;
  });

  return (
    <div className="tl-layer" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{ display: "contents" }}>
      {spans.map(({ s, i, start, nights }) => {
        if (!nights) return null;
        // Occupies the nights, draws nothing: there is no city to name.
        if (s.transit) return null;
        // Arrive during the day, leave during the day. The bar therefore runs
        // midday-to-midday and meets its neighbour exactly on the travel day.
        const from = Math.max(0, Math.min(start, days.length));
        const to = Math.min(start + nights, days.length - 1);
        if (to < from) return null;
        return (
          <div
            key={s.id}
            role={onPick ? "button" : undefined}
            tabIndex={onPick ? 0 : undefined}
            onClick={onPick ? (e) => { if (e.target.closest(".handle")) return; onPick(s.id); } : undefined}
            onKeyDown={onPick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(s.id); } } : undefined}
            className={`seg${readOnly ? " ro" : ""}${s.locked ? " locked" : ""}${onPick ? " pickable" : ""}${selectedId === s.id ? " selected" : ""}`}
            style={{ gridColumn: `${colMid(from)} / ${colMid(to)}`, background: s.color }}
            title={`${s.city || "unnamed"} — ${nights} night${nights === 1 ? "" : "s"}${s.locked ? " (locked)" : ""}`}
          >
            <span className="seg-name">{s.city || "unnamed"}</span>
            {s.locked && <span className="seg-lock" title="Dates locked">◆</span>}
            <span className="seg-n">{nights}n</span>
            {!readOnly && !s.locked && !(segments[i + 1] && segments[i + 1].locked) && (
              <button
                className={`handle${i === spans.length - 1 ? " last" : ""}`}
                onPointerDown={(e) => onPointerDown(e, i, i === spans.length - 1 ? "end" : "boundary")}
                onKeyDown={(e) => key(e, i, i === spans.length - 1 ? "end" : "boundary")}
                aria-label={i === spans.length - 1
                  ? `Change how many nights in ${s.city || "the last city"}`
                  : `Move nights between ${s.city || "this city"} and ${segments[i + 1].city || "the next city"}`}
              />
            )}
          </div>
        );
      })}

      {/* Days you wake in one city and sleep in another. Drawn on the boundary
          itself, so the handover is visible rather than implied. */}
      {(moves || []).map((m) => (
        m.idx < 0 || m.idx >= days.length ? null : (
          <div key={`m${m.iso}`} className="segmove" style={{ gridColumn: `${colMid(m.idx)} / ${colEnd(m.idx)}` }}
            title={`Travel day — wake in ${m.wake}, sleep in ${m.sleep}`} aria-hidden="true" />
        )
      ))}

      {/* Day trips sit on top of the stop they belong to. The Hotels row above
          keeps saying where you sleep, so this can safely say where you went. */}
      {(trips || []).map((d) => (
        d.idx < 0 || d.idx >= days.length ? null : (
          <div key={d.iso} className="segtrip" style={{ gridColumn: wholeDay(d.idx) }}
            title={`Day trip to ${d.city} — sleeping in ${d.base}`}>
            <span>{d.city}</span>
          </div>
        )
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- root */

export default function Timeline({ days, layers, holidays, offRange, footer, compact, onPickDay, selectedDay }) {
  const rowRef = useRef(null);
  const [colW, setColW] = useState(0);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width - LABEL_W;
      setColW(days.length ? Math.max(1, w / days.length) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [days.length]);

  if (!days.length) return <div className="tl-empty">Set a date window and the calendar appears here.</div>;

  const cols = colsFor(days.length);
  const inOff = (d) => offRange && offRange.start && offRange.end && d >= offRange.start && d <= offRange.end;

  return (
    <div className="tl-scroll" ref={rowRef}>
      <div className={`tl${compact ? " compact" : ""}`} style={{ minWidth: Math.max(560, days.length * 34 + LABEL_W) }}>
        {/* Full-height rules at each week boundary, so seven-day chunks read
            at a glance without adding a border to every layer. */}
        <div className="tl-weeks" style={{ gridTemplateColumns: cols }} aria-hidden="true">
          <div />
          {days.map((d, i) => (
            <div key={d} style={{ gridColumn: wholeDay(i) }} className={isWeekStart(d, i) ? "wk" : "dayline"} />
          ))}
        </div>

        <div className="tl-row months" style={{ gridTemplateColumns: cols }}>
          <MonthRow days={days} />
        </div>
        <div className="tl-row head" style={{ gridTemplateColumns: cols }}>
          <DayHeader days={days} holidays={holidays} inRange={inOff} onPickDay={onPickDay} selectedDay={selectedDay} />
        </div>

        {layers.map((L) => (
          <div key={L.key}
            className={`tl-row ${L.kind}${L.active ? " active" : ""}${L.kind === "segments" ? " seg-row" : ""}`}
            style={{ gridTemplateColumns: cols }}>
            <div className="tl-gutter lbl">{L.label}</div>

            {L.kind === "pick" && <PickLayer days={days} value={L.value} onChange={L.onChange} />}

            {L.kind === "segments" && (
              <SegmentLayer days={days} segments={L.segments} origin={L.origin || 0}
                onChange={L.onChange} readOnly={L.readOnly} colW={colW} trips={L.trips}
                moves={L.moves} onPick={L.onPick} selectedId={L.selectedId} />
            )}

            {L.kind === "bars" && L.bars.map((b) => {
              if (b.startIdx < 0 || b.endIdx < b.startIdx) return null;
              const a = Math.max(0, b.startIdx);
              const z = Math.min(b.endIdx, days.length - 1);
              const style = {
                gridColumn: b.half
                  ? `${colMid(a)} / ${colMid(Math.min(z + 1, days.length - 1))}`
                  : `${colStart(a)} / ${colEnd(z)}`,
                ...(b.color ? { background: b.color, borderColor: b.color, color: "#fff" } : {}),
              };
              const body = (
                <>
                  <span>{b.left}</span>
                  {b.mid && <span className="bar-mid">{b.mid}</span>}
                  <span>{b.right}</span>
                </>
              );
              return b.onClick ? (
                <button key={b.key} type="button"
                  className={`bar bar-${b.tone || "plain"} clickable${b.selected ? " selected" : ""}`}
                  style={style} title={b.title} onClick={b.onClick} aria-pressed={!!b.selected}>
                  {body}
                </button>
              ) : (
                <div key={b.key} className={`bar bar-${b.tone || "plain"}`} style={style} title={b.title}>
                  {body}
                </div>
              );
            })}

            {L.kind === "points" && L.points.map((pt) => (
              pt.idx < 0 || pt.idx >= days.length ? null : (
                <button
                  key={pt.key} type="button"
                  className={`point ${pt.tone || ""}${pt.selected ? " selected" : ""}`}
                  style={{ gridColumn: wholeDay(pt.idx) }}
                  title={pt.title} onClick={pt.onClick} aria-pressed={!!pt.selected}
                >
                  <span className="pt-glyph" aria-hidden="true">{pt.glyph}</span>
                  <span className="pt-label">{pt.label}</span>
                  {pt.off && <span className="pt-off" aria-hidden="true">!</span>}
                </button>
              )
            ))}

            {L.kind === "ticks" && days.map((d, i) => (
              <div key={d} className="tickcell" style={{ gridColumn: wholeDay(i) }}>
                <button type="button"
                  className={`tick${L.marks[i] ? "" : " empty"}${L.marks[i] && L.marks[i].trip ? " daytrip" : ""}${L.marks[i] && L.marks[i].locked ? " locked" : ""}${L.selectedIso === d ? " selected" : ""}`}
                  title={L.marks[i] ? L.marks[i].title : "Nothing planned yet"}
                  onClick={() => L.onPick && L.onPick(d)}>
                  {L.marks[i] ? L.marks[i].n : ""}
                </button>
              </div>
            ))}

            {L.note && <div className="tl-none" style={{ gridColumn: `2 / ${colEnd(days.length - 1)}` }}>{L.note}</div>}
          </div>
        ))}

        {footer && <div className="tl-foot">{footer}</div>}
      </div>
    </div>
  );
}
