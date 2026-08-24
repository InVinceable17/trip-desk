import React, { useState } from "react";
import { costSummary, fmtMoney, CURRENCIES, DEFAULT_RATES } from "../model.js";
import { Btn } from "./ui.jsx";

/* ============================================================================
   Where the number in the header comes from.

   Two questions it has to answer: what makes up the total, and how much of it
   is money already gone. Amounts stay in the currency they were entered in;
   the base-currency column is a conversion, and the rate that did it is
   visible and editable — nothing here calls a rate service.
   ========================================================================== */

const GROUPS = ["Transport", "Stays", "Days"];

export default function CostBreakdown({ trip, update, onClose, readOnly }) {
  const [rates, setRates] = useState(false);
  const sum = costSummary(trip);
  const base = sum.base;

  return (
    <section className="card costpanel">
      <div className="card-head">
        <div className="lbl accent">What this total is made of</div>
        <div className="grow" />
        <button className="det-close" onClick={onClose} aria-label="Close the breakdown">×</button>
      </div>

      <div className="card-body">
        <div className="cost-heads">
          <div className="cost-big">
            <span className="num">{fmtMoney(sum.total, base)}</span>
            <span className="lbl">total</span>
          </div>
          <div className="cost-split">
            <div className="paid">
              <span className="num">{fmtMoney(sum.paid, base)}</span>
              <span className="lbl">already paid</span>
            </div>
            <div className="due">
              <span className="num">{fmtMoney(sum.due, base)}</span>
              <span className="lbl">still to pay</span>
            </div>
          </div>
          {sum.total > 0 && (
            <div className="cost-bar" role="img"
              aria-label={`${Math.round((sum.paid / sum.total) * 100)} percent paid`}>
              <span className="seg-paid" style={{ width: `${(sum.paid / sum.total) * 100}%` }} />
            </div>
          )}
        </div>

        {!sum.lines.length && (
          <div className="empty">Nothing costs anything yet. Prices you enter anywhere show up here.</div>
        )}

        {sum.lines.length > 0 && (
          <div className="tbl-scroll">
            <table className="tbl costs">
              <thead>
                <tr>
                  <th>What</th><th>Detail</th>
                  <th className="num">Amount</th>
                  <th className="num">In {base}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.filter((g) => sum.groups[g]).map((g) => (
                  <React.Fragment key={g}>
                    <tr className="grouprow">
                      <td colSpan={2}>{g}</td>
                      <td />
                      <td className="num strong">{fmtMoney(sum.groups[g].paid + sum.groups[g].due, base)}</td>
                      <td className="muted">
                        {sum.groups[g].due === 0 ? "all paid" : `${fmtMoney(sum.groups[g].due, base)} due`}
                      </td>
                    </tr>
                    {sum.lines.filter((l) => l.group === g).map((l) => (
                      <tr key={l.id} className={l.paid ? "paidrow" : ""}>
                        <td>{l.label}</td>
                        <td className="muted">{l.detail}</td>
                        <td className="num">{fmtMoney(l.amount, l.currency)}</td>
                        <td className="num">{l.currency === base ? "" : fmtMoney(l.base, base)}</td>
                        <td>
                          <span className={`chip${l.paid ? " st-booked" : ""}`}>{l.paid ? "paid" : "to pay"}</span>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sum.mixed && (
          <div className="cost-cur">
            {Object.entries(sum.currencies).map(([code, v]) => (
              <span key={code}>
                <b>{code}</b> {fmtMoney(v.paid + v.due, code)}
                {v.due > 0 && <span className="muted"> · {fmtMoney(v.due, code)} due</span>}
              </span>
            ))}
          </div>
        )}

        <div className="row-wrap mt8 center">
          <span className="hint inline">
            {sum.mixed
              ? `Converted to ${base} with your own rates — nothing is fetched.`
              : `All in ${base}.`}
          </span>
          <div className="grow" />
          <Btn className="sm" onClick={() => setRates((v) => !v)}>{rates ? "Hide rates" : "Rates"}</Btn>
        </div>

        {rates && (
          <div className="row-wrap mt8 center ratebox">
            <span className="lbl">1 unit =</span>
            {CURRENCIES.map((c) => (
              <label key={c} className="rate">
                <span>{c}</span>
                <input
                  className="num right" inputMode="decimal" disabled={readOnly || c === "USD"}
                  value={(trip.rates || {})[c] != null ? trip.rates[c] : DEFAULT_RATES[c]}
                  onChange={(e) => update((t) => ({
                    ...t, rates: { ...t.rates, [c]: parseFloat(e.target.value) || 0 },
                  }))}
                />
                <span className="muted">USD</span>
              </label>
            ))}
            <div className="grow" />
            <label className="rate">
              <span className="lbl">Report in</span>
              <select className="auto" value={base} disabled={readOnly}
                onChange={(e) => update((t) => ({ ...t, baseCurrency: e.target.value }))}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
