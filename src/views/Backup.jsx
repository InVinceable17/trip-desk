import React, { useState, useEffect } from "react";
import { readSnapshots, restoreSnapshot, exportBundle, importBundle, HOSTED } from "../store.js";
import { Btn, Card } from "../components/ui.jsx";

/* ============================================================================
   Backup — three layers.

     1. Snapshots   automatic, every save, kept in this browser. No permission,
                    no network, no clicking. This is the real autosave.
     2. A file      on the hosted site this is an ordinary download. Inside the
                    Claude artifact it goes through `downloads.save`, which
                    always asks first — that is the platform's rule, not a
                    shortcut taken here.
     3. Paste-back  copy the JSON and hand it to Claude, or move a whole desk
                    from one backend to the other.
   ========================================================================== */

const when = (ms) => {
  const d = new Date(ms);
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleString();
};

export default function Backup({ db, onRestore, readOnly }) {
  const [snaps, setSnaps] = useState([]);
  const [msg, setMsg] = useState("");
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [downloads, setDownloads] = useState(undefined);

  useEffect(() => { setSnaps(readSnapshots()); }, [db]);
  useEffect(() => {
    if (HOSTED) { setDownloads("direct"); return; }   // an ordinary page can just save the file
    (async () => {
      const d = window.claude && window.claude.use ? await window.claude.use("downloads").catch(() => null) : null;
      setDownloads(d);
    })();
  }, []);

  const stamp = new Date().toISOString().slice(0, 10);
  const bundle = () => exportBundle(db);

  const save = async () => {
    if (!downloads) return;
    setMsg("");
    if (HOSTED) {
      // No permission prompt out here — the browser's own download is enough.
      const url = URL.createObjectURL(new Blob([bundle()], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `trip-desk-${stamp}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg("Saved to your downloads.");
      return;
    }
    try {
      await downloads.save({ filename: `trip-desk-${stamp}.json`, data: bundle() });
      setMsg("Saved. Keep it somewhere your backups get picked up.");
    } catch (e) {
      const code = (e && e.code) || "unavailable";
      setMsg(
        code === "declined" ? "You cancelled that save — nothing was written."
          : code === "too_large" ? "The file is over the 16 MB limit. Delete some trips first."
            : code === "rate_limited" ? "A save prompt is already open."
              : "This view can't hand you a file. Copy the JSON instead.",
      );
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bundle());
      setMsg("Copied. Paste it into the other build's Restore box, or hand it to Claude.");
    } catch { setMsg("Couldn't reach the clipboard — select the JSON below and copy it by hand."); }
  };

  return (
    <div className="stack">
      <Card title="Backups" accent>
        <p className="hint" style={{ marginTop: 0 }}>
          {HOSTED
            ? "Your trips live in Firestore and follow you between devices. These are the extra copies, in case something goes wrong there."
            : "Your trips are kept in this artifact and are saved as you work. These are the extra copies, for while we're still changing the app underneath you."}
        </p>

        <div className="row-wrap mt8 center">
          {downloads !== null && (
            <Btn kind="solid" onClick={save} disabled={downloads === undefined}>Download a backup file</Btn>
          )}
          <Btn onClick={copy}>Copy JSON</Btn>
          <Btn onClick={() => setShowPaste((v) => !v)} disabled={readOnly}>Restore from JSON</Btn>
          <span className="flash">{msg}</span>
        </div>
        {downloads === null && (
          <div className="banner note tight">
            This view can't hand you a file — copy the JSON instead. (A published page never writes
            to your disk without a confirmation, and this view isn't offering one.)
          </div>
        )}

        {showPaste && (
          <div className="mt8">
            <textarea rows={6} className="mono-sm" value={paste} placeholder="Paste a backup file's contents here"
              onChange={(e) => setPaste(e.target.value)} />
            <div className="row-wrap mt8 center">
              <Btn kind="solid" disabled={readOnly || !paste.trim()} onClick={() => {
                const next = importBundle(paste);
                if (!next) return setMsg("That isn't a Trip Desk backup.");
                onRestore(next);
                setPaste(""); setShowPaste(false);
                setMsg(`Restored ${next.order.length} trip${next.order.length === 1 ? "" : "s"}.`);
              }}>Replace everything with this</Btn>
              <span className="hint inline">This overwrites the trips currently on the desk.</span>
            </div>
          </div>
        )}
      </Card>

      <Card title="Automatic snapshots"
        right={<span className="muted">{snaps.length} kept in this browser</span>}>
        <p className="hint" style={{ marginTop: 0 }}>
          Taken every time something saves, capped at 25. They live in this browser only — a
          different machine won't have them — so they're the fast undo, not the archive.
        </p>
        {!snaps.length && <div className="empty">No snapshots yet. Change something and one appears.</div>}
        {snaps.length > 0 && (
          <div className="snaplist mt8">
            {snaps.map((s) => (
              <div key={s.at} className="snaprow">
                <span className="num">{when(s.at)}</span>
                <span className="muted">{s.trips} trip{s.trips === 1 ? "" : "s"}</span>
                <span className="muted">{(s.body.length / 1024).toFixed(0)} KB</span>
                <div className="grow" />
                <Btn className="sm" disabled={readOnly} onClick={() => {
                  const next = restoreSnapshot(s.at);
                  if (!next) return setMsg("That snapshot couldn't be read.");
                  onRestore(next);
                  setMsg(`Rolled back to the snapshot from ${when(s.at)}.`);
                }}>Restore</Btn>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
