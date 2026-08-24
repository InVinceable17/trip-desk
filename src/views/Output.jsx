import React, { useState } from "react";
import { blocks, text as itineraryText, pieces, blankDays, docDays } from "../doc-emit.js";
import { Btn } from "../components/ui.jsx";

/* ============================================================================
   Output.jsx — the trip as the planning doc, live.

   Not a new way to look at the trip: the same itinerary the doc already holds,
   regenerated from whatever the app currently knows, in the doc's own shape.
   The point is the clipboard. She writes in the doc, the Source panel reads it
   in, the trip gets edited here, and this hands back something that pastes
   straight over the top without her having to learn a new format.

   Rendered from `blocks()` and copied from `text()`, both out of doc-emit.js —
   a preview that disagreed with what you pasted would be worse than none.
   ========================================================================== */

export default function Output({ trip, onBack }) {
  const [copied, setCopied] = useState("");
  const bs = blocks(trip);
  const days = docDays(trip);
  const empty = blankDays(trip);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(itineraryText(trip));
      setCopied("Copied");
    } catch {
      setCopied("Couldn't reach the clipboard — select the text and copy it by hand.");
    }
    setTimeout(() => setCopied(""), 2500);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <Btn onClick={onBack}>Back</Btn>
        <div className="grow" />
        {empty.length > 0 && (
          <span className="hint inline">{empty.length} of {days.length} days still empty</span>
        )}
        <Btn kind="solid" onClick={copy}>Copy for the doc</Btn>
        <span className="flash">{copied}</span>
      </div>

      {!days.length && (
        <div className="card"><div className="card-body">
          <div className="empty">Set the trip's dates and the itinerary writes itself.</div>
        </div></div>
      )}

      {days.length > 0 && (
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
  );
}
