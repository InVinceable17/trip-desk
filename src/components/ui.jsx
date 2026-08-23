import React from "react";

export const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

export const Field = ({ label, children, w, hint }) => (
  <label className="fld" style={{ flex: w || "1 1 110px" }}>
    <span className="lbl">{label}</span>
    {children}
    {hint && <span className="fld-hint">{hint}</span>}
  </label>
);

export const Btn = ({ kind = "ghost", className = "", ...p }) => (
  <button type="button" {...p} className={`btn btn-${kind} ${className}`} />
);

export const Spinner = () => <span className="spin" aria-hidden="true" />;

/**
 * An amount and the currency it is in. Every price in the app is a pair, so
 * this is the only way to enter one.
 */
export const Amount = ({ value, currency, onChange, disabled, placeholder = "0", codes, bare }) => (
  <span className={`amount${bare ? " bare-amount" : ""}`}>
    <input
      className={bare ? "bare num right" : "num right"} inputMode="decimal"
      value={value} disabled={disabled} placeholder={placeholder}
      onChange={(e) => onChange({ value: e.target.value, currency })}
    />
    <select
      className="curpick" value={currency || "USD"} disabled={disabled} aria-label="Currency"
      onChange={(e) => onChange({ value, currency: e.target.value })}
    >
      {(codes || ["USD", "EUR", "GBP", "CHF", "JPY"]).map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  </span>
);

export const Chip = ({ tone = "", children }) => <span className={`chip ${tone}`}>{children}</span>;

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const Card = ({ title, right, children, accent, className = "" }) => (
  <section className={`card ${accent ? "accent-top" : ""} ${className}`}>
    {(title || right) && (
      <div className="card-head">
        <div className="lbl accent">{title}</div>
        <div className="grow" />
        {right}
      </div>
    )}
    <div className="card-body">{children}</div>
  </section>
);

/** A number that reads as money, with an "est." marker when it's a quote. */
export const Money = ({ value, estimated, sub }) => (
  <span className="moneyval">
    <span className="num">{money(value)}</span>
    {estimated && <span className="est">est.</span>}
    {sub && <span className="sub">{sub}</span>}
  </span>
);
