/* ============================================================================
   Source.jsx — the doc this trip is a view of.

   Two pieces. `SourceBar` is the always-visible strip under the header saying
   where these plans came from and whether they still agree with it; the panel
   it opens is where you pull an update and settle the disagreements.

   The bar is the point of the whole feature. A trip fed by somebody else's doc
   that does not say so is just a trip with mysterious contents.
   ========================================================================== */

import React, { useState, useMemo } from "react";

import { Btn, Card, Chip, Empty } from "../components/ui.jsx";
import { parseDoc, importPrompt } from "../doc-parse.js";
import { applyDoc, driftList, acceptDoc, keepMine, detach } from "../doc-sync.js";

/* Elapsed time, rounded the way a person would say it. Anything older than a
   week is a date — "13 days ago" is not information, it's arithmetic. */
function ago(iso) {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "never";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days <= 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const docName = (src) => src.docTitle || (src.docUrl ? "the linked doc" : "a document");

/* ------------------------------------------------------------------- bar */

export function SourceBar({ trip, readOnly, update, who }) {
  const [open, setOpen] = useState(false);
  const src = trip.source || {};
  const attached = src.kind === "gdoc";
  const drift = useMemo(() => driftList(trip), [trip]);

  return (
    <>
      <div className={`srcbar${drift.length ? " has-drift" : ""}${attached ? "" : " slim"}`}>
        {attached && <span className="srcbar-mark" aria-hidden="true" />}
        {attached ? (
          <>
            <span className="srcbar-txt">
              From <strong>{docName(src)}</strong>
              <span className="srcbar-when"> · read {ago(src.syncedAt)}{src.syncedBy ? ` by ${src.syncedBy}` : ""}</span>
            </span>
            {drift.length > 0 && (
              <Chip tone="warn">{drift.length} differ{drift.length === 1 ? "s" : ""}</Chip>
            )}
            {src.docUrl && (
              <a className="link" href={src.docUrl} target="_blank" rel="noreferrer noopener">open doc</a>
            )}
          </>
        ) : null}
        <span className="grow" />
        <Btn kind={drift.length ? "solid" : "ghost"} onClick={() => setOpen((v) => !v)} disabled={readOnly}>
          {open ? "close" : attached ? (drift.length ? "review" : "pull update") : "link a doc"}
        </Btn>
      </div>

      {open && (
        <SourcePanel
          trip={trip} who={who} drift={drift}
          update={update} onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/* ----------------------------------------------------------------- panel */

function SourcePanel({ trip, who, drift, update, onClose }) {
  const src = trip.source || {};
  const [text, setText] = useState("");
  const [url, setUrl] = useState(src.docUrl || "");
  const [title, setTitle] = useState(src.docTitle || "");
  const [mode, setMode] = useState("doc-wins");
  const [preview, setPreview] = useState(null);   // { parsed, error }
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);

  const read = () => {
    setDone(null);
    if (!text.trim()) { setPreview({ error: "Paste the doc's text first." }); return; }
    try {
      const parsed = parseDoc(text, {
        anchor: (trip.dates && trip.dates.start) || "",
        docUrl: url.trim(), docTitle: title.trim(),
      });
      setPreview({ parsed });
    } catch (e) {
      setPreview({ error: e.message });
    }
  };

  const apply = () => {
    const parsed = preview && preview.parsed;
    if (!parsed) return;
    let stat = null;
    update((t) => {
      const r = applyDoc(t, parsed, { mode, by: who || "" });
      stat = r;
      return r.trip;
    });
    setDone(stat);
    setPreview(null);
    setText("");
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(importPrompt(trip));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  };

  const p = preview && preview.parsed;

  return (
    <Card title="The doc behind this trip" accent className="srcpanel"
      right={<Btn onClick={onClose}>done</Btn>}>

      {/* ---- where it lives ---- */}
      <div className="row-wrap">
        <label className="fld" style={{ flex: "2 1 320px" }}>
          <span className="lbl">Doc link</span>
          <input value={url} placeholder="https://docs.google.com/document/d/…"
            onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="fld" style={{ flex: "1 1 180px" }}>
          <span className="lbl">Call it</span>
          <input value={title} placeholder="the Italy planning doc"
            onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>

      {/* ---- pulling it in ---- */}
      <div className="lbl accent gap-t">Pull the doc in</div>
      <textarea
        className="srcpaste" rows={7} value={text} placeholder="Paste the doc's text — or JSON from Claude"
        onChange={(e) => { setText(e.target.value); setPreview(null); setDone(null); }}
      />
      <div className="row-wrap">
        <Btn kind="solid" onClick={read} disabled={!text.trim()}>read it</Btn>
        <Btn onClick={copyPrompt}>{copied ? "prompt copied ✓" : "copy import prompt"}</Btn>
        <span className="grow" />
        <label className="fld inline" style={{ flex: "0 0 auto" }}>
          <span className="lbl">Where we disagree</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="doc-wins">the doc wins</option>
            <option value="record">keep what's here</option>
          </select>
        </label>
      </div>

      {preview && preview.error && <div className="banner warn gap-t">{preview.error}</div>}

      {p && (
        <div className="srcpreview gap-t">
          <div className="lbl accent">What it found</div>
          <ul className="srcfound">
            {p.name && <li><b>{p.name}</b></li>}
            {p.dates && <li>{p.dates.start} → {p.dates.end}</li>}
            {p.travelers ? <li>{p.travelers} travellers</li> : null}
            {p.segments.length > 0 && (
              <li>{p.segments.map((s) => `${s.city} ${s.nights}n`).join(" · ")}</li>
            )}
            {p.stays.length > 0 && <li>{p.stays.map((s) => s.name).join(" · ")}</li>}
            {Object.keys(p.days).length > 0 && (
              <li>{Object.keys(p.days).length} days with plans</li>
            )}
          </ul>

          {p.unparsed.length > 0 && (
            <details className="srcunparsed">
              <summary>{p.unparsed.length} line{p.unparsed.length === 1 ? "" : "s"} not understood</summary>
              <ul>{p.unparsed.slice(0, 40).map((l, i) => <li key={i}>{l}</li>)}</ul>
            </details>
          )}

          <div className="row-wrap gap-t">
            <Btn kind="solid" onClick={apply}>bring this in</Btn>
            <Btn onClick={() => setPreview(null)}>discard</Btn>
          </div>
        </div>
      )}

      {done && (
        <div className="banner good gap-t">
          Read the doc — {done.added} added, {done.updated} updated
          {done.kept ? `, ${done.kept} of yours kept` : ""}.
        </div>
      )}

      {/* ---- disagreements ---- */}
      <div className="lbl accent gap-t">
        Differences
        {drift.length > 0 && <span className="muted"> · {drift.length}</span>}
      </div>
      {drift.length === 0 ? (
        <Empty>
          {src.kind === "gdoc" ? "Everything matches." : "Pull the doc in first."}
        </Empty>
      ) : (
        <table className="srcdrift">
          <thead>
            <tr><th>Field</th><th>The doc says</th><th>This trip says</th><th /></tr>
          </thead>
          <tbody>
            {drift.map((d) => (
              <tr key={d.path} className={d.state}>
                <td className="lbl">{d.label}</td>
                <td className="doc">{String(d.docValue) || <span className="muted">empty</span>}</td>
                <td className="mine">
                  {d.state === "orphan"
                    ? <span className="muted">deleted here</span>
                    : String(d.tripValue) || <span className="muted">empty</span>}
                </td>
                <td className="acts">
                  {d.state !== "orphan" && (
                    <Btn onClick={() => update((t) => acceptDoc(t, d.path))}>use doc</Btn>
                  )}
                  <Btn onClick={() => update((t) => keepMine(t, d.path))}>keep ours</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {src.kind === "gdoc" && (
        <div className="row-wrap gap-t">
          <span className="grow" />
          <Btn onClick={() => { update((t) => detach(t)); onClose(); }}>
            unlink the doc
          </Btn>
        </div>
      )}
    </Card>
  );
}

export default SourceBar;
