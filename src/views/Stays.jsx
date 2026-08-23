import React, { useState } from "react";
import { label as dayLabel } from "../flights.js";
import { segmentSpans, blankStay, STAY_STATUSES, segColor, leadStay, nightsBetween, hotelsIn, mapsSearch, fmtMoney } from "../model.js";
import { Field, Btn, Card, Amount } from "../components/ui.jsx";

/* Phase 4, deliberately plain. Candidate places per city segment, with
   check-in and check-out derived from the segment so moving a city moves the
   stay with it. No scraping yet — the shape comes first. */

export default function Stays({ trip, update, readOnly }) {
  const spans = segmentSpans(trip);
  const [open, setOpen] = useState(null);

  const setStays = (fn) => update((t) => ({ ...t, stays: fn(t.stays) }));

  if (!spans.length) {
    return (
      <div className="stack">
        <div className="banner note">
          Lay out your cities first — stays hang off those segments, so they know their own dates.
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {spans.map(({ seg, i, startDate, endDate }) => {
        const list = trip.stays.filter((s) => s.segmentId === seg.id);
        const lead = leadStay(trip, seg.id);
        const nights = nightsBetween(startDate, endDate);
        return (
          <Card
            key={seg.id}
            title={
              <span className="segtitle">
                <span className="swatch-lg" style={{ background: segColor(i) }} aria-hidden="true" />
                {seg.city || "unnamed city"}
              </span>
            }
            right={
              <span className="segright">
                <span className="muted">
                  Arrive {dayLabel(startDate)} · depart {dayLabel(endDate)} · {nights} night{nights === 1 ? "" : "s"}
                  {lead ? <> · {fmtMoney(lead.total, lead.currency)}{lead.status === "Booked" ? " booked" : " est."}</> : " · nothing yet"}
                </span>
                {seg.city && (
                  <span className="maplinks">
                    <a href={hotelsIn(seg.city)} target="_blank" rel="noreferrer">hotels on maps ↗</a>
                    <a href={mapsSearch(seg.city)} target="_blank" rel="noreferrer">{seg.city} ↗</a>
                  </span>
                )}
              </span>
            }
          >
            {list.length === 0 && <div className="empty">No places saved for {seg.city || "this stop"} yet.</div>}

            {list.length > 0 && (
              <div className="tbl-scroll">
                <table className="tbl stays">
                  <thead>
                    <tr><th>Place</th><th className="num">Total</th><th className="num">Per night</th><th>Status</th><th>Confirmation</th><th>Notes</th><th /></tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id} className={s.status === "Booked" ? "booked" : s.status === "Ruled out" ? "dim" : ""}>
                        <td>
                          <input className="bare" value={s.name} disabled={readOnly} placeholder="Name"
                            onChange={(e) => setStays((all) => all.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
                          {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="tiny">open</a>}
                        </td>
                        <td className="num">
                          <Amount bare value={s.total} currency={s.currency} disabled={readOnly}
                            onChange={({ value, currency }) => setStays((all) => all.map((x) => (x.id === s.id ? { ...x, total: value, currency } : x)))} />
                        </td>
                        <td className="num muted">{s.total && nights ? fmtMoney(+s.total / nights, s.currency) : "—"}</td>
                        <td>
                          <select value={s.status} disabled={readOnly}
                            onChange={(e) => setStays((all) => all.map((x) => (x.id === s.id ? { ...x, status: e.target.value } : x)))}>
                            {STAY_STATUSES.map((x) => <option key={x}>{x}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="bare" value={s.ref} disabled={readOnly} placeholder="—"
                            onChange={(e) => setStays((all) => all.map((x) => (x.id === s.id ? { ...x, ref: e.target.value } : x)))} />
                        </td>
                        <td>
                          <input className="bare" value={s.notes} disabled={readOnly} placeholder="—"
                            onChange={(e) => setStays((all) => all.map((x) => (x.id === s.id ? { ...x, notes: e.target.value } : x)))} />
                        </td>
                        <td>
                          <Btn className="sm" onClick={() => setOpen(open === s.id ? null : s.id)}>Link</Btn>
                          <Btn className="sm" kind="danger" disabled={readOnly}
                            onClick={() => setStays((all) => all.filter((x) => x.id !== s.id))}>×</Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {open && list.some((s) => s.id === open) && (
              <div className="row-wrap mt8">
                <Field label="Link" w="1 1 320px">
                  <input value={(list.find((s) => s.id === open) || {}).url || ""} disabled={readOnly} placeholder="https://…"
                    onChange={(e) => setStays((all) => all.map((x) => (x.id === open ? { ...x, url: e.target.value } : x)))} />
                </Field>
              </div>
            )}

            <div className="row-wrap mt8">
              <Btn disabled={readOnly} onClick={() => setStays((all) => [...all, { ...blankStay(seg.id) }])}>
                + Add a place in {seg.city || "this city"}
              </Btn>
              {seg.city && list.length > 0 && (
                <span className="hint inline">
                  A day trip out of {seg.city} doesn't move this booking — set the day's location in <b>Days</b>.
                </span>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
