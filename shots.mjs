import { chromium } from "playwright";
import { serve } from "./serve.mjs";
const trip = {
  schema: 2, id: "t1", name: "Italy", createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-22T00:00:00Z",
  travelers: 2, window: { start: "2026-10-10", end: "2026-10-25" }, target: { minNights: 3, maxNights: 21 },
  dates: { start: "2026-10-12", end: "2026-10-23", locked: true }, holidays: ["2026-10-12"],
  homeAirports: "CVG, ATL, BNA, TYS, CHA", destAirports: "FCO, MXP, VCE, NAP, FLR, BLQ",
  flights: {
    options: [{
      id: "o1", name: "Delta — into Rome, out of Naples", status: "Shortlist", priceEach: "2736",
      fare: "Main Classic", bookVia: "Delta", url: "", notes: "", checks: [],
      fares: [{ name: "Main Classic", each: 2736 }, { name: "Main Extra", each: 3086 }, { name: "Comfort Classic", each: 3786 }],
      out: { date: "2026-10-12", from: "ATL", to: "FCO", depart: "16:05", arrive: "07:35", plusOne: true, stops: "nonstop", carrier: "Delta", flight: "DL 214", dur: "9h 30m" },
      ret: { date: "2026-10-23", from: "NAP", to: "ATL", depart: "09:05", arrive: "14:39", plusOne: false, stops: "nonstop", carrier: "Delta", flight: "DL 279", dur: "11h 34m" },
    }],
    bookedId: "o1", booking: { ref: "HJ4K2P", paidTotal: "5240", currency: "USD", url: "https://delta.com/mytrips", notes: "seats 24A/24B" },
  },
  segments: [
    { id: "s1", city: "Rome", nights: 4, locked: true },
    { id: "s2", city: "Florence", nights: 3, locked: true },
    { id: "s3", city: "Naples", nights: 4, locked: false }],
  travel: [
    { id: "tr1", kind: "train", date: "2026-10-16", from: "Rome", to: "Florence", depart: "09:20", arrive: "10:52", ref: "Frecciarossa 9512", cost: "96", currency: "EUR", booked: true, notes: "", plusOne: false, carrier: "Trenitalia" },
    { id: "tr2", kind: "train", date: "2026-10-19", from: "Florence", to: "Naples", depart: "14:05", arrive: "17:00", ref: "Frecciarossa 9430", cost: "112", currency: "EUR", booked: false, notes: "", plusOne: false, carrier: "Trenitalia" }],
  stays: [
    { id: "st1", segmentId: "s1", name: "Hotel Artemide", url: "https://example.com", total: "1090", currency: "EUR", ref: "AR-88231", status: "Booked", notes: "near Termini" },
    { id: "st2", segmentId: "s2", name: "Palazzo Guadagni", url: "", total: "805", currency: "EUR", status: "Shortlist", notes: "" },
  ],
  days: {
    "2026-10-14": { notes: "", items: [], city: "Pompeii", locked: false },
    "2026-10-13": { locked: true, city: "", notes: "Ancient Rome day — start early, book the Colosseum slot.", items: [
      { id: "i1", title: "Colosseum + Forum combined", url: "https://example.com", cost: "36", currency: "EUR", time: "09:00", kind: "ticket", done: false },
      { id: "i2", title: "Lunch near Monti", url: "", cost: "", time: "13:00", kind: "idea", done: false }] },
    "2026-10-16": { notes: "", items: [{ id: "i3", title: "Uffizi timed entry", url: "https://example.com", cost: "50", currency: "EUR", time: "", kind: "ticket", done: false }] },
  },
};
const trip2 = { ...JSON.parse(JSON.stringify(trip)), id: "t2", name: "Japan, cherry blossom",
  dates: { start: "2027-03-28", end: "2027-04-09", locked: false }, window: { start: "2027-03-20", end: "2027-04-15" },
  segments: [{ id: "q1", city: "Tokyo", nights: 5 }, { id: "q2", city: "Kyoto", nights: 4 }],
  stays: [], days: {}, flights: { options: [], bookedId: null, booking: { ref: "", paidTotal: "" } },
  destAirports: "HND, NRT, KIX, ITM" };
const idx = JSON.stringify({ schema: 2, trips: [{ id: "t1" }, { id: "t2" }], prefs: {} });
const server = await serve(8811, { "data/index.json": idx, "data/trips/t1.json": JSON.stringify(trip), "data/trips/t2.json": JSON.stringify(trip2) });
/* Playwright finds its own browser. PW_CHROME overrides that, the same way
   check.mjs and check-web.mjs do — a hardcoded path here meant this script
   only ever ran on one machine. */
const CHROME = process.env.PW_CHROME;
const b = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errs = [];
async function shot(name, hash, theme, w = 1280) {
  const p = await b.newPage({ viewport: { width: w, height: 1000 }, colorScheme: theme });
  p.on("pageerror", (e) => errs.push(`${name}: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load/.test(m.text())) errs.push(`${name}: ${m.text()}`); });
  await p.addInitScript(() => { window.claude = { use: async (n) => n === "artifact" ? { publish: async () => ({ version: "v" }) } : null }; });
  await p.goto("http://localhost:8811/" + hash, { waitUntil: "load" });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `shot-${name}.png`, fullPage: true });
  await p.close();
}
await shot("landing", "#/", "light");
await shot("dates", "#/t/t1/dates", "light");
await shot("flights", "#/t/t1/flights", "light");
await shot("cities", "#/t/t1/cities", "dark");
await shot("stays", "#/t/t1/stays", "light");
await shot("days", "#/t/t1/days", "dark");
await shot("narrow", "#/t/t1/cities", "light", 420);
await shot("backup", "#/backup", "light");
await shot("phone-days", "#/t/t1/days", "light", 390);
await shot("phone-cities", "#/t/t1/cities", "light", 390);
{
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: "light" });
  await p.addInitScript(() => { window.claude = { use: async () => null }; });
  await p.goto("http://localhost:8811/#/t/t1/stays", { waitUntil: "load" });
  await p.waitForTimeout(900);
  await p.click(".costbtn");
  await p.waitForTimeout(300);
  await p.screenshot({ path: "shot-cost.png", fullPage: true });
  await p.close();
}
console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "no errors");
await b.close(); server.close();
