import React, { useState } from "react";
import { Btn, Spinner } from "../components/ui.jsx";

/* The gate on the hosted build. The Firebase config in this page is public by
   design — it identifies the project, it does not authorise anything. What
   decides whether you get the data is the allowlist in firestore.rules. */

export default function SignIn({ auth, describeError }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /* Not async before the call: signIn() has to open its popup inside the click
     that triggered it, or Safari treats the window as unsolicited and blocks
     it. Awaiting anything first — even a state update that settles — is enough
     to lose the gesture. */
  const go = () => {
    setBusy(true); setErr("");
    auth.signIn()
      .catch((e) => setErr(describeError ? describeError(e) : (e.message || "Sign-in failed.")))
      .finally(() => setBusy(false));
  };

  return (
    <div className="signin">
      <div className="card signin-card">
        <div className="card-body">
          <div className="brand static">
            <span className="brandmark" aria-hidden="true" />
            Trip Desk
          </div>
          <p className="hint">
            Your trips are kept in one place and follow you between devices. Sign in with the
            Google account on the allowlist.
          </p>

          {!auth.configured && (
            <div className="banner warn tight">
              This build has no Firebase project wired in yet, so there's nothing to sign in to.
              Add <code>firebase.config.json</code> and rebuild.
            </div>
          )}

          <div className="row-wrap mt8 center">
            <Btn kind="solid" onClick={go} disabled={busy || !auth.configured}>
              {busy ? <><Spinner /> Signing in…</> : "Sign in with Google"}
            </Btn>
          </div>

          {err && <div className="banner warn tight">{err}</div>}

          <p className="hint">
            Not on the allowlist? Signing in will work but the trips won't load — that's the rules
            doing their job, not a bug.
          </p>
        </div>
      </div>
    </div>
  );
}
