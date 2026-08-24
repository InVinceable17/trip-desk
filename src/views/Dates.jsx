import React, { useState } from "react";
import { label as dayLabel, ISO } from "../flights.js";
import { nightsBetween, ptoNote, assignedNights } from "../model.js";
import { Field, Btn, Card } from "../components/ui.jsx";

/* Phase 1. A soft window comes in; locked start and end dates go out. */

export default function Dates({ trip, update, readOnly }) {
  const [holiday, setHoliday] = useState("");

  const hasWindow = !!(trip.window.start && trip.window.end);
  const chosen = trip.dates.start && trip.dates.end;
  const nights = chosen ? nightsBetween(trip.dates.start, trip.dates.end) : 0;
  const note = chosen ? ptoNote(trip) : null;
  const { minNights, maxNights } = trip.target;
  const tooShort = chosen && nights < minNights;
  const tooLong = chosen && nights > maxNights;

  const dependents = (trip.segments || []).length + (trip.stays || []).length
    + Object.values(trip.days || {}).filter((d) => d && ((d.items || []).length || d.notes)).length;

  const setWindow = (patch) => update((t) => ({ ...t, window: { ...t.window, ...patch } }));

  const lock = () => update((t) => ({ ...t, dates: { ...t.dates, locked: true } }));
  const unlock = () => update((t) => ({ ...t, dates: { ...t.dates, locked: false } }));

  return (
    <div className="stack">
      <Card title="Window" accent>
        <div className="row-wrap">
          <Field label="Earliest departure" w="0 1 170px">
            <input type="date" value={trip.window.start} disabled={readOnly}
              onChange={(e) => setWindow({ start: e.target.value })} />
          </Field>
          <Field label="Latest return" w="0 1 170px">
            <input type="date" value={trip.window.end} disabled={readOnly}
              onChange={(e) => setWindow({ end: e.target.value })} />
          </Field>
          <Field label="Shortest trip" w="0 1 120px" hint="nights">
            <input inputMode="numeric" value={trip.target.minNights} disabled={readOnly}
              onChange={(e) => update((t) => ({ ...t, target: { ...t.target, minNights: Math.max(1, +e.target.value || 1) } }))} />
          </Field>
          <Field label="Longest trip" w="0 1 120px" hint="nights">
            <input inputMode="numeric" value={trip.target.maxNights} disabled={readOnly}
              onChange={(e) => update((t) => ({ ...t, target: { ...t.target, maxNights: Math.max(1, +e.target.value || 1) } }))} />
          </Field>
          <Field label="Travelers" w="0 1 100px">
            <input inputMode="numeric" value={trip.travelers} disabled={readOnly}
              onChange={(e) => update((t) => ({ ...t, travelers: Math.max(1, +e.target.value || 1) }))} />
          </Field>
        </div>
      </Card>

      <Card title="Dates">
        {hasWindow ? (
          <>
            <div className="readout">
              {chosen ? (
                <>
                  <div className="readout-main">
                    <span className="big">{nights}</span>
                    <span className="unit">night{nights === 1 ? "" : "s"}</span>
                    <span className="dates">{dayLabel(trip.dates.start)} → {dayLabel(trip.dates.end)}</span>
                  </div>
                  <div className="readout-side">
                    <span><b>{note.pto}</b> weekday{note.pto === 1 ? "" : "s"} to book off</span>
                    <span><b>{note.weekendDays}</b> weekend day{note.weekendDays === 1 ? "" : "s"} free</span>
                    {note.holidaysUsed > 0 && <span><b>{note.holidaysUsed}</b> holiday{note.holidaysUsed === 1 ? "" : "s"} covering weekdays</span>}
                  </div>
                </>
              ) : (
                <div className="readout-main muted">
                  Pick a start and an end day on the calendar.
                </div>
              )}
            </div>

            {(tooShort || tooLong) && (
              <div className="banner note tight">
                {nights} nights — outside your {minNights}–{maxNights} target.
              </div>
            )}

            <div className="row-wrap mt8 center">
              {trip.dates.locked ? (
                <>
                  <span className="chip st-booked">Locked</span>
                  <Btn onClick={unlock} disabled={readOnly}>Unlock</Btn>
                </>
              ) : (
                <>
                  <Btn kind="solid" onClick={lock} disabled={readOnly || !chosen}>Lock these dates</Btn>
                  <Btn onClick={() => update((t) => ({ ...t, dates: { start: "", end: "", locked: false } }))}
                    disabled={readOnly || !trip.dates.start}>Clear</Btn>
                </>
              )}
            </div>

            {!trip.dates.locked && trip.dates.start && dependents > 0 && (
              <div className="banner warn tight">
                {dependents} thing{dependents === 1 ? "" : "s"} downstream depend on these dates
                — {assignedNights(trip.segments)} nights of cities are laid out.
              </div>
            )}
          </>
        ) : (
          <div className="empty">Set a window above.</div>
        )}
      </Card>

      <Card title="Holidays">
        <div className="row-wrap center">
          <Field label="Add a date" w="0 1 170px">
            <input type="date" value={holiday} disabled={readOnly} onChange={(e) => setHoliday(e.target.value)} />
          </Field>
          <Btn disabled={readOnly || !ISO.test(holiday)} onClick={() => {
            update((t) => ({ ...t, holidays: [...new Set([...(t.holidays || []), holiday])].sort() }));
            setHoliday("");
          }}>Add</Btn>
        </div>
        {(trip.holidays || []).length > 0 && (
          <div className="taglist mt8">
            {trip.holidays.map((h) => (
              <span key={h} className="tag">
                {dayLabel(h)}
                <button aria-label={`Remove ${dayLabel(h)}`} disabled={readOnly}
                  onClick={() => update((t) => ({ ...t, holidays: t.holidays.filter((x) => x !== h) }))}>×</button>
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
