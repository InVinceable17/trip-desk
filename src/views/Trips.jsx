import React, { useState } from "react";
import { label as dayLabel } from "../flights.js";
import { PHASES, phaseState, tripCost, tripNights, indexEntry } from "../model.js";
import { Btn, money } from "../components/ui.jsx";

/* The landing page: every saved trip, newest work first. */

export default function Trips({ trips, order, onOpen, onNew, onDuplicate, onDelete, readOnly, missing }) {
  const [confirm, setConfirm] = useState(null);

  const list = order.map((id) => trips[id]).filter(Boolean);
  const sorted = [...list].sort((a, b) => {
    const aUp = a.dates.start || a.window.start || "";
    const bUp = b.dates.start || b.window.start || "";
    if (aUp && bUp && aUp !== bUp) return aUp.localeCompare(bUp);
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });

  return (
    <div className="stack">
      <div className="toolbar">
        <Btn kind="solid" onClick={onNew} disabled={readOnly}>+ New trip</Btn>
        <div className="grow" />
      </div>

      {missing && missing.length > 0 && (
        <div className="banner warn">
          {missing.length} trip{missing.length === 1 ? "" : "s"} couldn't be read from storage. Try reloading.
        </div>
      )}

      {!list.length && (
        <div className="card"><div className="card-body">
          <div className="empty">No trips yet.</div>
        </div></div>
      )}

      <div className="tripgrid">
        {sorted.map((t) => {
          const cost = tripCost(t);
          const nights = tripNights(t);
          const e = indexEntry(t);
          return (
            <article key={t.id} className="tripcard">
              <button className="tripmain" onClick={() => onOpen(t.id)}>
                <div className="tripname">{t.name || "Untitled trip"}</div>
                <div className="tripwhen">
                  {e.start
                    ? <>{dayLabel(e.start)} → {dayLabel(e.end)}{nights ? ` · ${nights} nights` : ""}</>
                    : <span className="muted">no dates yet</span>}
                  {t.dates.locked && <span className="chip st-booked">locked</span>}
                </div>
                {e.dest && <div className="tripdest">{e.dest}</div>}

                <div className="phasedots" aria-hidden="true">
                  {PHASES.map((p) => (
                    <span key={p.key} className={`dot is-${phaseState(t, p.key)}`} title={p.label} />
                  ))}
                </div>

                <div className="tripfoot">
                  <span className="num strong">{cost.total ? money(cost.total) : "—"}</span>
                  {cost.total > 0 && <span className="muted">{cost.estimated ? "estimated" : "booked"}</span>}
                  <span className="grow" />
                  <span className="muted">{t.travelers} traveler{t.travelers === 1 ? "" : "s"}</span>
                </div>
              </button>

              <div className="tripacts">
                <Btn className="sm" onClick={() => onDuplicate(t.id)} disabled={readOnly}>Duplicate</Btn>
                <Btn className="sm" kind="danger" disabled={readOnly}
                  onClick={() => setConfirm(t.id)}>Delete</Btn>
              </div>

              {confirm === t.id && (
                <div className="confirm">
                  <span>Delete “{t.name}” and everything in it?</span>
                  <Btn className="sm" kind="danger" onClick={() => { setConfirm(null); onDelete(t.id); }}>Delete</Btn>
                  <Btn className="sm" onClick={() => setConfirm(null)}>Keep</Btn>
                </div>
              )}
            </article>
          );
        })}
      </div>

    </div>
  );
}
