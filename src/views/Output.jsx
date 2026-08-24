import React, { useState, useEffect } from "react";
import { blocks, text as itineraryText, pieces, blankDays, docDays } from "../doc-emit.js";
import { Btn } from "../components/ui.jsx";

/* ============================================================================
   Output.jsx — the trip as the planning doc, live, in a drawer.

   Not a new way to look at the trip: the same itinerary the doc already holds,
   regenerated from whatever the app currently knows, in the doc's own shape.
   The point is the clipboard. She writes in the doc, the Source panel reads it
   in, the trip gets edited here, and this hands back something that pastes
   straight over the top without her having to learn a new format.

   It is a drawer rather than a page on purpose. The reason to look at it is to
   watch a change land — edit a night, see the day rewrite itself — and you
   cannot do that from somewhere you had to navigate to. So it sits over the
   right edge, the app underneath stays live, and there is no backdrop to click
   through: you keep working with the document open beside you.

   "Live" needs no machinery. `blocks()` is a pure function of the trip, this
   renders during App's render, and every edit goes through updateTrip — so a
   keystroke and the line it rewrites happen in the same paint. Nothing is
   cached and there is nothing to invalidate.
   ========================================================================== */

export default function Output({ trip, open, onClose }) {
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* The class drives a body-level shift so the app slides over rather than
     hiding under the drawer; see `body.doc-open` in page.html. */
  useEffect(() => {
    document.body.classList.toggle("doc-open", !!open);
    return () => document.body.classList.remove("doc-open");
  }, [open]);

  const bs = blocks(trip);
  const days = docDays(trip);
  const empty = blankDays(trip);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(itineraryText(trip));
      setCopied("Copied");
    } catch {
      setCopied("Couldn't reach the clipboard — select the text and copy it.");
    }
    setTimeout(() => setCopied(""), 2500);
  };

  return (
    <aside className={`docdrawer${open ? " open" : ""}`} aria-hidden={!open}
      aria-label="Itinerary for the planning doc">
      <div className="dd-bar">
        <span className="lbl accent">Itinerary</span>
        {empty.length > 0 && (
          <span className="dd-count">{empty.length} of {days.length} days empty</span>
        )}
        <span className="grow" />
        <span className="flash">{copied}</span>
        <Btn className="sm" kind="solid" onClick={copy} disabled={!days.length}>Copy</Btn>
        <Btn className="sm" onClick={onClose} aria-label="Close the itinerary">×</Btn>
      </div>

      <div className="dd-body">
        {!days.length
          ? <div className="empty">Set the trip&rsquo;s dates and the itinerary writes itself.</div>
          : (
            <article className="sheet-doc">
              {bs.map((b, i) => {
                if (b.kind === "title") return <h1 key={i} className="sd-title">{b.text}</h1>;
                if (b.kind === "range") return <p key={i} className="sd-range">{b.text}</p>;
                if (b.kind === "day") return <h2 key={i} className="sd-day">{b.text}</h2>;
                return (
                  <p key={i} className={`sd-b${b.depth ? " sub" : ""}`}>
                    {pieces(b.text).map((x, j) => (x.url
                      ? <a key={j} href={x.url} target="_blank" rel="noreferrer">{x.text}</a>
                      : <span key={j}>{x.text}</span>))}
                  </p>
                );
              })}
            </article>
          )}
      </div>
    </aside>
  );
}
