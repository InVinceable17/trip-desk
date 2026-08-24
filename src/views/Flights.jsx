import React, { useState, useMemo, useEffect } from "react";
import {
  range, parseDur, showDur, to12h, label as dayLabel,
  searchUrl, fareUrl, searchUrlFor, partialUrl, legOk, flightParts,
  STATUSES, blankLeg, blankOption, flagsFor,
} from "../flights.js";
import { parsePaste } from "../parsers.js";
import { scanSearch, resolveFlightNo, checkPrice, callCost, errText } from "../scrape.js";
import { stashDraft, takeDraft } from "../store.js";
import { blankTravel, TRAVEL_KINDS, KIND_GLYPH, travelLegs, fmtMoney, bookedFlight } from "../model.js";
import { HOSTED } from "../store.js";
import { Field, Btn, Spinner, Card, money, Amount } from "../components/ui.jsx";

export default function Flights({ trip, update, mcp, readOnly }) {
  const [draft, setDraft] = useState(() => takeDraft());
  const [sort, setSort] = useState("price");
  const [panel, setPanel] = useState(null);
  const [io, setIo] = useState("");
  const [flash, setFlash] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState({});
  const [booking, setBooking] = useState(null);
  const [shopping, setShopping] = useState(false);
  const [search, setSearch] = useState(() => ({
    out: { date: trip.dates.start || "", from: "", to: "" },
    ret: { date: trip.dates.end || "", from: "", to: "" },
    rows: null, retRows: null, stage: "", err: "", picked: null,
  }));

  const options = trip.flights.options;
  const bookedId = trip.flights.bookedId;
  const canCheck = !HOSTED && !!mcp && !readOnly;

  useEffect(() => { if (draft) stashDraft(draft); }, [draft]);

  const setOptions = (next) => update((t) => ({ ...t, flights: { ...t.flights, options: next } }));

  /* the rail spans the locked trip, or the soft window while dates are open */
  const railStart = trip.dates.start || trip.window.start;
  const railEnd = trip.dates.end || trip.window.end;
  const DAYS = useMemo(() => range(railStart, railEnd), [railStart, railEnd]);
  const idx = (iso) => DAYS.indexOf(iso);

  const homeList = (trip.homeAirports || "").split(/[,\s]+/).filter(Boolean);
  const destList = (trip.destAirports || "").split(/[,\s]+/).filter(Boolean);

  const sorted = useMemo(() => {
    const arr = [...options];
    arr.sort((a, b) => {
      if (a.id === bookedId) return -1;
      if (b.id === bookedId) return 1;
      if (sort === "price") return (+a.priceEach || 1e9) - (+b.priceEach || 1e9);
      if (sort === "time") return ((parseDur(a.out.dur) || 1e9) + (parseDur(a.ret.dur) || 0)) - ((parseDur(b.out.dur) || 1e9) + (parseDur(b.ret.dur) || 0));
      if (sort === "depart") return (a.out.date || "9").localeCompare(b.out.date || "9");
      return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
    });
    return arr;
  }, [options, sort, bookedId]);

  const running = Object.values(busy).some((v) => v && v.running);

  /* ------------------------------------------------------------ price check */
  const refresh = async (list) => {
    if (!mcp) return;
    for (const o of list) {
      const stage = (msg) => setBusy((b) => ({ ...b, [o.id]: { running: true, msg } }));
      stage("starting");
      const r = await checkPrice(mcp, o, stage);
      setBusy((b) => ({ ...b, [o.id]: r.error ? { running: false, msg: r.error } : null }));
      if (r.error) continue;
      update((t) => ({
        ...t,
        flights: {
          ...t.flights,
          options: t.flights.options.map((x) => {
            if (x.id !== o.id) return x;
            const pick = r.fares.find((f) => f.name.toLowerCase() === (x.fare || "").toLowerCase()) || r.fares[0];
            return {
              ...x, fare: pick.name, fares: r.fares, priceEach: String(pick.each),
              out: { ...x.out, flight: x.out.flight || r.found.out },
              ret: { ...x.ret, flight: x.ret.flight || r.found.ret },
              checks: [...(x.checks || []), { at: new Date().toISOString(), each: pick.each, fare: pick.name }].slice(-12),
            };
          }),
        },
      }));
    }
  };

  /* ---------------------------------------------------------------- search */
  const setS = (patch) => setSearch((s) => ({ ...s, ...patch }));

  const runSearch = async () => {
    if (!mcp) return;
    const url = searchUrlFor(search.out, legOk(search.ret) ? search.ret : null);
    if (!url) return setS({ err: "Fill in a date and two 3-letter airport codes." });
    setS({ stage: "searching", err: "", rows: null, retRows: null, picked: null });
    try { setS({ stage: "", rows: await scanSearch(mcp, url) }); }
    catch (e) { setS({ stage: "", err: errText(e) }); }
  };

  const pickOutbound = (row) => {
    const d = blankOption();
    d.out = {
      ...blankLeg(), date: search.out.date, from: row.from || search.out.from, to: row.to || search.out.to,
      depart: row.depart, arrive: row.arrive, plusOne: row.plusOne,
      stops: row.stops, carrier: row.carrier, dur: row.dur, flight: "",
    };
    d.ret = { ...blankLeg(), plusOne: false, date: search.ret.date, from: search.ret.from, to: search.ret.to };
    d.priceEach = row.price ? String(row.price) : "";
    d.bookVia = row.carrier;
    d.name = `${row.carrier} — ${d.out.from} to ${d.out.to}`;
    setDraft(d);
    setS({ picked: row, retRows: null });
  };

  const findReturns = async () => {
    if (!mcp || !draft) return;
    setS({ stage: "resolving", err: "" });
    try {
      const a = flightParts(draft.out)
        || await resolveFlightNo(mcp, searchUrl(draft), draft.out.depart, (draft.out.carrier || "").slice(0, 2));
      const withNo = { ...draft, out: { ...draft.out, flight: `${a.code} ${a.num}` } };
      setDraft(withNo);
      setS({ stage: "searching returns" });
      setS({ stage: "", retRows: await scanSearch(mcp, partialUrl(withNo, a)) });
    } catch (e) { setS({ stage: "", err: errText(e) }); }
  };

  const pickReturn = (row) => {
    setDraft((d) => ({
      ...d,
      ret: {
        ...d.ret, depart: row.depart, arrive: row.arrive, plusOne: row.plusOne,
        stops: row.stops, carrier: row.carrier, dur: row.dur,
        from: row.from || d.ret.from, to: row.to || d.ret.to,
      },
      priceEach: row.price ? String(row.price) : d.priceEach,
    }));
    setS({ retRows: null });
  };

  /* ----------------------------------------------------------------- edits */
  const save = () => {
    if (!draft.name.trim()) return setFlash("Give the option a name first.");
    const exists = options.some((o) => o.id === draft.id);
    setOptions(exists ? options.map((o) => (o.id === draft.id ? draft : o)) : [...options, draft]);
    setDraft(null); setFlash(""); takeDraft();
    setS({ rows: null, retRows: null, picked: null });
  };

  const confirmBooking = () => {
    const b = booking;
    update((t) => ({
      ...t,
      flights: {
        ...t.flights,
        bookedId: b.id,
        booking: { ref: b.ref, paidTotal: b.paidTotal, currency: b.currency, url: b.url, notes: b.notes },
        options: t.flights.options.map((o) => (o.id === b.id ? { ...o, status: "Shortlist" } : o)),
      },
      ...(b.adoptDates && b.start && b.end
        ? { dates: { start: b.start, end: b.end, locked: true } }
        : {}),
    }));
    setBooking(null);
  };

  const startBooking = (o) => setBooking({
    id: o.id,
    ref: trip.flights.booking.ref || "",
    currency: trip.flights.booking.currency || "USD",
    url: trip.flights.booking.url || o.url || "",
    notes: trip.flights.booking.notes || "",
    paidTotal: trip.flights.booking.paidTotal || String((+o.priceEach || 0) * trip.travelers || ""),
    start: o.out.date, end: o.ret.date,
    adoptDates: !!(o.out.date && o.ret.date && (o.out.date !== trip.dates.start || o.ret.date !== trip.dates.end)),
    mismatched: !!(o.out.date && o.ret.date && (o.out.date !== trip.dates.start || o.ret.date !== trip.dates.end)),
  });

  return (
    <div className="stack">
      {!trip.dates.locked && (
        <div className="banner note">Trip dates aren't locked yet.</div>
      )}

      {/* --------------------------------------------------------- what's set */}
      <Card title="Transport" accent>
        {!travelLegs(trip).length && (
          <div className="empty">Nothing set yet.</div>
        )}
        {travelLegs(trip).length > 0 && (
          <div className="travellist">
            {travelLegs(trip).map((L) => (
              <div key={L.id} className={`legcard${L.booked ? " booked" : ""}`}>
                <span className="legglyph" aria-hidden="true">{KIND_GLYPH[L.kind] || "→"}</span>
                <span className="legdate num">{dayLabel(L.date)}</span>
                <span className="legroute">{L.from || "?"} → {L.to || "?"}</span>
                <span className="muted num">
                  {L.depart ? to12h(L.depart) : ""}{L.arrive ? ` → ${to12h(L.arrive)}${L.plusOne ? " +1" : ""}` : ""}
                </span>
                <span className="muted">{[L.carrier, L.ref].filter(Boolean).join(" · ")}</span>
                <div className="grow" />
                {L.cost && (
                  <span className="num strong" title={L.costCoversTrip ? "The whole fare, both legs" : ""}>
                    {fmtMoney(L.cost, L.currency)}{L.costCoversTrip ? <span className="est">both legs</span> : null}
                  </span>
                )}
                {L.bookingRef && <span className="chip st-booked">conf. {L.bookingRef}</span>}
                {!L.bookingRef && L.booked && <span className="chip st-booked">booked</span>}
                {!L.booked && <span className="chip">not booked</span>}
                {L.url && <a href={L.url} target="_blank" rel="noreferrer" className="tiny">open ↗</a>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------ getting around */}
      <Card title="Between cities">
        {!(trip.travel || []).length && (
          <div className="empty">Nothing yet.</div>
        )}
        {(trip.travel || []).length > 0 && (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Kind</th><th>Date</th><th>From</th><th>To</th><th>Departs</th><th>Arrives</th>
                  <th>Operator / ref</th><th className="num">Cost</th><th>Link</th><th>Booked</th><th />
                </tr>
              </thead>
              <tbody>
                {trip.travel.map((x) => {
                  const set = (p) => update((t) => ({ ...t, travel: t.travel.map((y) => (y.id === x.id ? { ...y, ...p } : y)) }));
                  return (
                    <tr key={x.id} className={x.booked ? "booked" : ""}>
                      <td>
                        <select className="auto" value={x.kind} disabled={readOnly}
                          onChange={(e) => set({ kind: e.target.value })}>
                          {TRAVEL_KINDS.map((k) => <option key={k} value={k}>{KIND_GLYPH[k]} {k}</option>)}
                        </select>
                      </td>
                      <td><input className="bare" type="date" value={x.date} disabled={readOnly} onChange={(e) => set({ date: e.target.value })} /></td>
                      <td><input className="bare code" value={x.from} disabled={readOnly} placeholder="Rome" onChange={(e) => set({ from: e.target.value })} /></td>
                      <td><input className="bare code" value={x.to} disabled={readOnly} placeholder="Florence" onChange={(e) => set({ to: e.target.value })} /></td>
                      <td><input className="bare time" type="time" value={x.depart} disabled={readOnly} onChange={(e) => set({ depart: e.target.value })} /></td>
                      <td><input className="bare time" type="time" value={x.arrive} disabled={readOnly} onChange={(e) => set({ arrive: e.target.value })} /></td>
                      <td><input className="bare" value={x.ref} disabled={readOnly} placeholder="Frecciarossa 9512" onChange={(e) => set({ ref: e.target.value })} /></td>
                      <td className="num">
                        <Amount bare value={x.cost} currency={x.currency} disabled={readOnly}
                          onChange={({ value, currency }) => set({ cost: value, currency })} />
                      </td>
                      <td><input className="bare url" value={x.url} disabled={readOnly} placeholder="link" onChange={(e) => set({ url: e.target.value })} /></td>
                      <td><input type="checkbox" checked={x.booked} disabled={readOnly} aria-label="Booked" onChange={(e) => set({ booked: e.target.checked })} /></td>
                      <td>
                        <Btn className="sm" kind="danger" disabled={readOnly}
                          onClick={() => update((t) => ({ ...t, travel: t.travel.filter((y) => y.id !== x.id) }))}>×</Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="row-wrap mt8">
          {TRAVEL_KINDS.slice(0, 3).map((k) => (
            <Btn key={k} className="sm" disabled={readOnly}
              onClick={() => update((t) => ({ ...t, travel: [...(t.travel || []), blankTravel(k)] }))}>
              + {KIND_GLYPH[k]} {k}
            </Btn>
          ))}
        </div>
      </Card>


      {/* ------------------------------------------------------------ search */}
      {HOSTED && (
        <div className="banner note">
          Live fare search isn't available here — the <b>open fares</b> links still go to Google Flights.
        </div>
      )}
      {bookedFlight(trip) && !shopping && (
        <div className="row-wrap center">
          <Btn className="sm" onClick={() => setShopping(true)}>Shop for flights anyway</Btn>
        </div>
      )}

      {(!bookedFlight(trip) || shopping) && (
      <Card title="Find flights" accent>
        <div className="row-wrap">
          <Field label="Leave" w="0 1 150px"><input type="date" value={search.out.date} onChange={(e) => setS({ out: { ...search.out, date: e.target.value } })} /></Field>
          <Field label="From" w="0 1 90px"><input list="home" value={search.out.from} onChange={(e) => setS({ out: { ...search.out, from: e.target.value.toUpperCase() } })} /></Field>
          <Field label="To" w="0 1 90px"><input list="dest" value={search.out.to} onChange={(e) => setS({ out: { ...search.out, to: e.target.value.toUpperCase() } })} /></Field>
          <Field label="Return" w="0 1 150px"><input type="date" value={search.ret.date} onChange={(e) => setS({ ret: { ...search.ret, date: e.target.value } })} /></Field>
          <Field label="From" w="0 1 90px"><input list="dest" value={search.ret.from} onChange={(e) => setS({ ret: { ...search.ret, from: e.target.value.toUpperCase() } })} /></Field>
          <Field label="To" w="0 1 90px"><input list="home" value={search.ret.to} onChange={(e) => setS({ ret: { ...search.ret, to: e.target.value.toUpperCase() } })} /></Field>
          <div className="fld end">
            <Btn kind="solid" onClick={runSearch} disabled={!canCheck || !!search.stage}>
              {search.stage === "searching" ? <><Spinner /> Searching…</> : "Search"}
            </Btn>
          </div>
        </div>
        {search.err && <div className="banner warn tight">{search.err}</div>}
        {search.rows && <RowTable rows={search.rows} caption={`${search.rows.length} outbound flights`} onPick={pickOutbound} pickedKey={search.picked && search.picked.depart} />}
        {search.retRows && <RowTable rows={search.retRows} caption={`${search.retRows.length} return flights`} onPick={pickReturn} />}
      </Card>
      )}

      {/* ------------------------------------------------------------- paste */}
      {(!bookedFlight(trip) || shopping) && (
      <Card title="Or paste an itinerary">
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3}
          placeholder="ATL to FCO Oct 10, 4:05pm to 7:35am+1. NAP to ATL Oct 23, 9:05am to 2:39pm. Nonstop. $1,402 each." />
        <div className="row-wrap mt8 center">
          <Btn kind="solid" disabled={readOnly} onClick={() => {
            if (!paste.trim()) return;
            const r = parsePaste(paste, { ...trip, windowStart: trip.window.start, travelers: trip.travelers });
            setDraft(r.draft); setPaste(""); setFlash(r.ok ? "Read it — check it over, then save." : r.why);
          }}>Fill the form</Btn>
        </div>
      </Card>
      )}

      {/* ----------------------------------------------------------- toolbar */}
      <div className="toolbar">
        <Btn onClick={() => setDraft(blankOption())} disabled={readOnly}>+ Blank option</Btn>
        <Btn onClick={() => { setPanel(panel === "io" ? null : "io"); setIo(JSON.stringify(options, null, 2)); }}>Import / export</Btn>
        <div className="grow" />
        <span className="lbl">Sort</span>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="auto">
          <option value="price">Price</option><option value="time">Total air time</option>
          <option value="depart">Departure date</option><option value="status">Status</option>
        </select>
      </div>

      {panel === "io" && (
        <Card>
          <textarea value={io} onChange={(e) => setIo(e.target.value)} rows={8} className="mono-sm" />
          <div className="row-wrap mt8">
            <Btn kind="solid" disabled={readOnly} onClick={() => {
              try {
                const inc = JSON.parse(io);
                const list = Array.isArray(inc) ? inc : [inc];
                const map = new Map(options.map((o) => [o.id, o]));
                list.forEach((o) => map.set(o.id || `opt_${Math.random().toString(36).slice(2, 8)}`, {
                  ...blankOption(), ...o, out: { ...blankLeg(), ...(o.out || {}) }, ret: { ...blankLeg(), ...(o.ret || {}) },
                }));
                setOptions([...map.values()]); setFlash(`Imported ${list.length}.`);
              } catch { setFlash("That isn't valid JSON."); }
            }}>Import</Btn>
            <Btn onClick={() => { navigator.clipboard?.writeText(JSON.stringify(options, null, 2)); setFlash("Copied."); }}>Copy all</Btn>
            <span className="flash">{flash}</span>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------------ editor */}
      {draft && (
        <section className="card editor">
          <div className="card-body">
            <div className="row-wrap">
              <Field label="Option name" w="2 1 200px"><input placeholder="Delta nonstop" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Status" w="0 1 120px">
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Price each ($)" w="0 1 120px"><input inputMode="decimal" value={draft.priceEach} onChange={(e) => setDraft({ ...draft, priceEach: e.target.value })} /></Field>
              <Field label="Fare brand" w="0 1 140px"><input placeholder="Main Classic" value={draft.fare} onChange={(e) => setDraft({ ...draft, fare: e.target.value })} /></Field>
              <Field label="Booked through" w="0 1 130px"><input placeholder="Delta" value={draft.bookVia} onChange={(e) => setDraft({ ...draft, bookVia: e.target.value })} /></Field>
            </div>

            {[["out", "Outbound"], ["ret", "Return"]].map(([key, title]) => (
              <div key={key} className="leg">
                <div className="leg-head">
                  <span className="leg-title">{title}</span>
                  {key === "ret" && (
                    <>
                      <Btn className="sm" onClick={() => setDraft({ ...draft, ret: { ...draft.ret, from: draft.out.to, to: draft.out.from } })}>mirror airports</Btn>
                      {canCheck && legOk(draft.out) && legOk(draft.ret) && (
                        <Btn className="sm" onClick={findReturns} disabled={!!search.stage}>
                          {search.stage ? <><Spinner /> {search.stage}…</> : "find return flights"}
                        </Btn>
                      )}
                    </>
                  )}
                </div>
                <div className="row-wrap">
                  <Field label="Date" w="0 1 150px"><input type="date" value={draft[key].date} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], date: e.target.value } })} /></Field>
                  <Field label="From" w="0 1 90px"><input list={key === "out" ? "home" : "dest"} value={draft[key].from} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], from: e.target.value.toUpperCase() } })} /></Field>
                  <Field label="To" w="0 1 90px"><input list={key === "out" ? "dest" : "home"} value={draft[key].to} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], to: e.target.value.toUpperCase() } })} /></Field>
                  <Field label="Departs" w="0 1 110px"><input type="time" value={draft[key].depart} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], depart: e.target.value } })} /></Field>
                  <Field label="Arrives" w="0 1 110px"><input type="time" value={draft[key].arrive} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], arrive: e.target.value } })} /></Field>
                  <Field label="Next day" w="0 1 74px">
                    <div className="checkbox"><input type="checkbox" checked={draft[key].plusOne} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], plusOne: e.target.checked } })} /></div>
                  </Field>
                  <Field label="Stops" w="1 1 120px"><input placeholder="nonstop / AMS" value={draft[key].stops} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], stops: e.target.value } })} /></Field>
                  <Field label="Airline" w="1 1 120px"><input placeholder="Delta" value={draft[key].carrier} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], carrier: e.target.value } })} /></Field>
                  <Field label="Flight no." w="0 1 110px"><input placeholder="DL 214" value={draft[key].flight} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], flight: e.target.value.toUpperCase() } })} /></Field>
                  <Field label="Total time" w="0 1 110px"><input placeholder="10h 45m" value={draft[key].dur} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], dur: e.target.value } })} /></Field>
                </div>
              </div>
            ))}

            <div className="leg">
              <div className="row-wrap">
                <Field label="Link" w="2 1 260px"><input placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></Field>
                <Field label="Notes" w="2 1 260px"><input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
              </div>
            </div>

            <div className="row-wrap mt8 center">
              <Btn kind="solid" onClick={save} disabled={readOnly}>Save option</Btn>
              <Btn onClick={() => { setDraft(null); setFlash(""); takeDraft(); }}>Cancel</Btn>
              <span className="flash warn-text">{flash}</span>
            </div>
          </div>
        </section>
      )}

      <datalist id="home">{homeList.map((a) => <option key={a} value={a} />)}</datalist>
      <datalist id="dest">{destList.map((a) => <option key={a} value={a} />)}</datalist>

      {/* ------------------------------------------------------------- cards */}
      <div className="cards">
        {(bookedFlight(trip) && !shopping ? sorted.filter((o) => o.id === bookedId) : sorted).map((o) => (
          <OptionCard
            key={o.id} o={o} trip={trip} days={DAYS} state={busy[o.id]} running={running}
            canCheck={canCheck} readOnly={readOnly} booked={o.id === bookedId}
            onCheck={() => refresh([o])}
            onEdit={() => setDraft(JSON.parse(JSON.stringify(o)))}
            onDelete={() => {
              setOptions(options.filter((x) => x.id !== o.id));
              if (o.id === bookedId) update((t) => ({ ...t, flights: { ...t.flights, bookedId: null, booking: { ref: "", paidTotal: "" } } }));
            }}
            onFare={(f) => setOptions(options.map((x) => (x.id === o.id ? { ...x, fare: f.name, priceEach: String(f.each) } : x)))}
            onStatus={(s) => setOptions(options.map((x) => (x.id === o.id ? { ...x, status: s } : x)))}
            onBook={() => startBooking(o)}
            onUnbook={() => update((t) => ({ ...t, flights: { ...t.flights, bookedId: null, booking: { ref: "", paidTotal: "" } } }))}
          />
        ))}
      </div>

      {/* ------------------------------------------------------ booking modal */}
      {booking && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Record a booking">
          <div className="sheet-inner card">
            <div className="card-body">
              <div className="lbl accent">Mark this flight booked</div>
              <div className="row-wrap mt8">
                <Field label="Confirmation" w="1 1 150px"><input value={booking.ref} onChange={(e) => setBooking({ ...booking, ref: e.target.value.toUpperCase() })} placeholder="ABC123" /></Field>
                <Field label="Total paid" w="0 1 170px" hint={`for ${trip.travelers}`}>
                  <Amount value={booking.paidTotal} currency={booking.currency}
                    onChange={({ value, currency }) => setBooking({ ...booking, paidTotal: value, currency })} />
                </Field>
              </div>
              <div className="row-wrap">
                <Field label="Booking link" w="1 1 260px">
                  <input value={booking.url} placeholder="https://…" onChange={(e) => setBooking({ ...booking, url: e.target.value })} />
                </Field>
              </div>
              <div className="row-wrap">
                <Field label="Notes" w="1 1 300px">
                  <input value={booking.notes} placeholder="seats 24A/24B, bags paid" onChange={(e) => setBooking({ ...booking, notes: e.target.value })} />
                </Field>
              </div>
              {booking.mismatched && (
                <label className="adopt">
                  <input type="checkbox" checked={booking.adoptDates} onChange={(e) => setBooking({ ...booking, adoptDates: e.target.checked })} />
                  <span>
                    Move the trip to <b>{dayLabel(booking.start)} – {dayLabel(booking.end)}</b> to match these flights
                    {trip.dates.start ? <> (currently {dayLabel(trip.dates.start)} – {dayLabel(trip.dates.end)})</> : null}
                  </span>
                </label>
              )}
              <div className="row-wrap mt8">
                <Btn kind="solid" onClick={confirmBooking}>Save booking</Btn>
                <Btn onClick={() => setBooking(null)}>Cancel</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- result table */

function RowTable({ rows, caption, onPick, pickedKey }) {
  return (
    <div className="results">
      <div className="lbl mt8">{caption}</div>
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr><th>Depart</th><th>Arrive</th><th>Airline</th><th>Duration</th><th>Stops</th><th className="num">Per adult</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={pickedKey === r.depart ? "picked" : ""}>
                <td className="num">{to12h(r.depart)}</td>
                <td className="num">{to12h(r.arrive)}{r.plusOne ? <sup>+1</sup> : null}</td>
                <td>{r.carrier || "—"}</td>
                <td className="num">{r.dur || "—"}</td>
                <td>{r.stops === "nonstop" ? <span className="chip good">nonstop</span> : (r.stops || "—")}</td>
                <td className="num strong">{r.price ? money(r.price) : "—"}</td>
                <td><Btn className="sm" onClick={() => onPick(r)}>Use this</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- option card */

function OptionCard({ o, trip, days, state, running, canCheck, readOnly, booked, onCheck, onEdit, onDelete, onFare, onStatus, onBook, onUnbook }) {
  const f = flagsFor(o, { blockStart: trip.dates.start, blockEnd: trip.dates.end }, days);
  const a = days.indexOf(o.out.date), b = days.indexOf(o.ret.date);
  const nights = a >= 0 && b >= 0 ? b - a : null;
  const air = (parseDur(o.out.dur) || 0) + (parseDur(o.ret.dur) || 0);
  const checks = o.checks || [];
  const last = checks[checks.length - 1];
  const prev = checks.length > 1 ? checks[checks.length - 2] : null;
  const delta = last && prev ? last.each - prev.each : 0;
  const gs = fareUrl(o) || searchUrl(o);
  const cost = callCost(o);
  const paid = booked && +(trip.flights.booking.paidTotal || 0);
  const paidCur = trip.flights.booking.currency || "USD";

  return (
    <article className={`opt status-${o.status.replace(/\s/g, "").toLowerCase()}${booked ? " booked" : ""}`}>
      <div className="opt-head">
        <div className="opt-title">
          <span className="name">{o.name || "untitled"}</span>
          {booked
            ? <span className="chip st-booked">Booked{trip.flights.booking.ref ? ` · ${trip.flights.booking.ref}` : ""}</span>
            : (
              <select className="statuspick" value={o.status} onChange={(e) => onStatus(e.target.value)} disabled={readOnly} aria-label="Status">
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
          {o.bookVia && <span className="muted">via {o.bookVia}</span>}
        </div>
        <div className="opt-price">
          <div className="total">{paid ? fmtMoney(paid, paidCur) : o.priceEach ? money(+o.priceEach * trip.travelers) : "—"}</div>
          <div className="sub">
            {paid ? "paid" : `for ${trip.travelers}`} · {o.priceEach ? money(o.priceEach) : "—"} ea{o.fare ? ` · ${o.fare}` : ""}
          </div>
          {delta !== 0 && !booked && (
            <div className={delta < 0 ? "delta down" : "delta up"}>
              {delta < 0 ? "▼" : "▲"} {money(Math.abs(delta) * trip.travelers)} since last check
            </div>
          )}
        </div>
      </div>

      <div className="travellist">
        {[["out", "Out"], ["ret", "Back"]].map(([k, t]) => {
          const L = o[k];
          return (
            <div key={k} className={k === "out" ? "leg-cell divide" : "leg-cell"}>
              <div className="lbl accent">{t} · {dayLabel(L.date)}</div>
              <div className="route"><span>{L.from || "???"}</span><span className="rule" /><span>{L.to || "???"}</span></div>
              <div className="muted num">
                {L.depart ? to12h(L.depart) : "--:--"} → {L.arrive ? to12h(L.arrive) : "--:--"}{L.plusOne ? " +1" : ""} · {showDur(parseDur(L.dur))}
              </div>
              <div className="muted">{[L.stops, L.carrier, L.flight].filter(Boolean).join(" · ") || "—"}</div>
            </div>
          );
        })}
      </div>

      {(o.fares || []).length > 1 && !booked && (
        <div className="fares">
          {o.fares.map((fa) => {
            const on = fa.name.toLowerCase() === (o.fare || "").toLowerCase();
            return (
              <button key={fa.name} className={on ? "fare on" : "fare"} onClick={() => onFare(fa)} disabled={readOnly}>
                <span>{fa.name}</span> <span className="num">{money(fa.each * trip.travelers)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="opt-foot">
        {nights != null && <span>{nights} nights</span>}
        {air > 0 && <span>{showDur(air)} in the air</span>}
        {last && !booked && <span>checked {new Date(last.at).toLocaleDateString()}</span>}
        {o.notes && <span className="notes">{o.notes}</span>}
        {gs && <a href={gs} target="_blank" rel="noreferrer">{fareUrl(o) ? "open fares" : "open search"}</a>}
        {booked && trip.flights.booking.url && <a href={trip.flights.booking.url} target="_blank" rel="noreferrer">confirmation ↗</a>}
        {!booked && o.url && <a href={o.url} target="_blank" rel="noreferrer">booking link</a>}
        {booked && trip.flights.booking.notes && <span className="notes">{trip.flights.booking.notes}</span>}
        <div className="grow" />
        {booked
          ? (
            <>
              <Btn className="sm" onClick={onBook} disabled={readOnly}>Edit confirmation</Btn>
              <Btn className="sm" onClick={onUnbook} disabled={readOnly}>Not booked after all</Btn>
            </>
          )
          : (
            <>
              {canCheck && (
                <Btn className="sm" disabled={running || !cost} onClick={onCheck}
                  title={cost === 1 ? "One page load" : `${cost} page loads — flight numbers aren't cached yet`}>
                  {state?.running ? <><Spinner /> {state.msg}</> : `Check price${cost > 1 ? ` (${cost} loads)` : ""}`}
                </Btn>
              )}
              <Btn className="sm" kind="solid" onClick={onBook} disabled={readOnly}>Mark booked</Btn>
            </>
          )}
        <Btn className="sm" onClick={onEdit} disabled={readOnly}>Edit</Btn>
        <Btn kind="danger" className="sm" onClick={onDelete} disabled={readOnly}>Delete</Btn>
      </div>

      {state && !state.running && <div className="banner warn tight">{state.msg}</div>}
      {f.length > 0 && <div className="banner warn tight flags">{f.map((x) => <span key={x}>{x}</span>)}</div>}
    </article>
  );
}
