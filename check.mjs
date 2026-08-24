import { chromium } from "playwright";
import { serve } from "./serve.mjs";

/* Playwright finds its own browser. PW_CHROME overrides that for sandboxes
   that keep browsers outside the standard cache — which is where the absolute
   Linux path that used to live here came from. */
const CHROME = process.env.PW_CHROME;
const errs = [];
let fails = 0;
const check = (name, cond, extra) => {
  if (cond) console.log("  ok  " + name);
  else { console.log(" FAIL " + name + (extra ? "\n       " + JSON.stringify(extra) : "")); fails++; }
};

/* The exact v1 payload the live artifact holds today. */
const V1 = JSON.stringify({
  cfg: { tripName: "Italy", windowStart: "2026-10-10", windowEnd: "2026-10-25",
    blockStart: "2026-10-12", blockEnd: "2026-10-23", travelers: 2,
    homeAirports: "CVG, ATL, BNA, TYS, CHA", destAirports: "FCO, MXP, LIN, BGY, VCE, NAP, FLR, BLQ, PSA" },
  options: [{ id: "opt_seed_dl_fco_nap", name: "Delta — into Rome, out of Naples", status: "Maybe",
    priceEach: "2736", fare: "Main Classic", bookVia: "Delta", url: "", notes: "",
    fares: [{ name: "Main Classic", each: 2736 }, { name: "Main Extra", each: 3086 }], checks: [],
    out: { date: "2026-10-10", from: "ATL", to: "FCO", depart: "16:05", arrive: "07:35", plusOne: true, stops: "nonstop", carrier: "Delta", flight: "DL 214", dur: "9h 30m" },
    ret: { date: "2026-10-23", from: "NAP", to: "ATL", depart: "09:05", arrive: "14:39", plusOne: false, stops: "nonstop", carrier: "Delta", flight: "DL 279", dur: "11h 34m" } }],
});

const server = await serve(8811, { "data/state.json": V1 });
const b = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 1500 } });
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { const t = m.text(); if (m.type() === "error" && !/404|Failed to load resource/.test(t)) errs.push("console: " + t); });

await p.addInitScript(() => {
  window.__pub = [];
  window.claude = { use: async (n) => n === "artifact"
    ? { publish: async (files) => { window.__pub.push(files); return { version: "v" + window.__pub.length }; } }
    : n === "mcp" ? { callTool: async () => ({ payload: { data: { ready: true, rows: [] } } }) } : null };
});
await p.goto("http://localhost:8811/", { waitUntil: "load" });
await p.waitForTimeout(900);

console.log("\nmigration + landing");
check("lands on the trip browser", (await p.locator(".tripcard").count()) === 1);
check("the migrated trip keeps its name", (await p.textContent(".tripname")) === "Italy");
check("shows a flight-derived cost estimate", /5,472/.test(await p.textContent(".tripfoot")), await p.textContent(".tripfoot"));
await p.waitForTimeout(2400);
const pub1 = await p.evaluate(() => window.__pub.map((f) => Object.keys(f)));
check("writes the v2 layout on first load", JSON.stringify(pub1[0] || []).includes("data/index.json") && JSON.stringify(pub1[0] || []).includes("data/trips/"), pub1);

console.log("\nopening a trip");
await p.click(".tripmain");
await p.waitForTimeout(400);
check("stepper shows five phases", (await p.locator(".step").count()) === 5);
check("dates phase is current", (await p.getAttribute(".step.on", "aria-current")) === "step");
check("header shows the trip name", (await p.textContent(".tripname-btn")) === "Italy");

console.log("\nphase 1 — dates");
check("the ribbon renders the window picker", (await p.locator(".ribbon .tl-pick").count()) === 16);
await p.click(".ribbon .tl-pick >> nth=2");   // Oct 12
await p.click(".ribbon .tl-pick >> nth=13");  // Oct 23
await p.waitForTimeout(200);
check("reads back 11 nights", (await p.textContent(".readout-main .big")) === "11");
check("counts weekdays to book off", /10 weekday/.test(await p.textContent(".readout-side")), await p.textContent(".readout-side"));
await p.click("button:has-text('Lock these dates')");
await p.waitForTimeout(300);
check("locks the dates", (await p.locator(".chip.st-booked").count()) > 0);
check("dates step now reads done", (await p.locator(".step.done").count()) >= 1);

console.log("\nphase 3 — cities");
await p.click(".step:has-text('Cities')");
await p.waitForTimeout(300);
await p.click(".addrow:has-text('Add a stop')");
await p.waitForTimeout(150);
await p.fill(".segrow.adding .segcity", "Rome");
await p.click(".segrow.adding button:has-text('Add stop')");
await p.waitForTimeout(250);
check("first city takes the whole trip", /11.*of.*11/s.test((await p.textContent(".nightcount")).replace(/\s+/g, " ")), await p.textContent(".nightcount"));
await p.fill(".segrow.adding .segcity", "Florence");
await p.click(".segrow.adding button:has-text('Add stop')");
await p.waitForTimeout(250);
const counts = () => p.evaluate(() => [...document.querySelectorAll(".segnights .num")].map((x) => x.textContent));
check("two segments exist", (await counts()).length === 2, await counts());
const before = (await counts()).map((x) => parseInt(x, 10));
check("adding a second city stays inside the trip length", before.reduce((a, b) => a + b, 0) === 11, before);

// drag the boundary between Rome and Florence two columns left
const handle = p.locator(".ribbon .seg .handle").first();
const box = await handle.boundingBox();
const colW = await p.evaluate(() => {
  const row = document.querySelector(".ribbon .seg-row");
  return (row.getBoundingClientRect().width - 120) / document.querySelectorAll(".ribbon .tl-row.head .tl-day").length;
});
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.mouse.down();
await p.mouse.move(box.x + box.width / 2 - colW * 2, box.y + box.height / 2, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(250);
const after = (await counts()).map((x) => parseInt(x, 10));
check("dragging moved two nights across the boundary", after[0] === before[0] - 2 && after[1] === before[1] + 2, { before, after });
check("drag conserved the total", after.reduce((a, b) => a + b, 0) === 11, after);

console.log("\nlocking and reordering cities");
check("cities step is not done while any city is unlocked",
  (await p.evaluate(() => document.querySelector(".step:nth-child(3)").className)).includes("started"));
await p.click(".segrow:first-child button:has-text('Lock')");
await p.waitForTimeout(200);
check("a locked city says so", (await p.textContent(".segrow:first-child")).includes("Locked"));
check("a locked city's nights can't be nudged",
  await p.evaluate(() => document.querySelector(".segrow.locked .segnights button").disabled));
check("the ribbon drops the handle next to a locked city",
  (await p.locator(".ribbon .seg.locked .handle").count()) === 0);
await p.click(".segrow:nth-child(2) button:has-text('Lock')");
await p.waitForTimeout(250);
check("cities step turns done once every city is locked",
  (await p.evaluate(() => document.querySelector(".step:nth-child(3)").className)).includes("done"));
const orderBefore = await p.evaluate(() => [...document.querySelectorAll(".segcity")].map((i) => i.value).filter(Boolean));
await p.focus(".segrow:first-child .drag");
await p.keyboard.press("ArrowDown");
await p.waitForTimeout(250);
const orderAfter = await p.evaluate(() => [...document.querySelectorAll(".segcity")].map((i) => i.value).filter(Boolean));
check("a city can be reordered from the keyboard",
  orderAfter.join(",") === [...orderBefore].reverse().join(","), { orderBefore, orderAfter });
// put it back so later assertions read in the original order
await p.focus(".segrow:nth-child(2) .drag");
await p.keyboard.press("ArrowUp");
await p.waitForTimeout(250);

console.log("\nthe ribbon accumulates");
const layers = () => p.evaluate(() => [...document.querySelectorAll(".ribbon .tl-row")].map((r) => r.className.split(" ")[1]));
check("the ribbon sits above the stepper", await p.evaluate(() => {
  const r = document.querySelector(".ribbon"), st = document.querySelector(".stepper");
  return !!(r && st) && (r.compareDocumentPosition(st) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}));
check("the calendar names its months", (await p.locator(".ribbon .tl-month").count()) >= 1);
check("week boundaries are ruled", (await p.locator(".ribbon .tl-weeks .wk").count()) >= 1);
check("cities phase shows months + header + trip + travel + cities + days",
  (await layers()).join(",") === "months,head,bars,points,segments,ticks", await layers());
check("travel is discrete points, one per leg", (await p.locator(".ribbon .point").count()) === 2);
check("a leg outside the locked dates is flagged, not dropped",
  (await p.locator(".ribbon .point.off").count()) === 1,
  await p.evaluate(() => [...document.querySelectorAll(".ribbon .point")].map((x) => x.title)));
await p.click(".step:has-text('Dates')");
await p.waitForTimeout(300);
check("the ribbon follows to Dates and keeps the city layer", (await layers()).includes("segments"), await layers());
check("locked dates show as a bar, not a picker", (await p.locator(".ribbon .tl-pick").count()) === 0);

console.log("\nphases 4 and 5");
await p.click(".step:has-text('Stays')");
await p.waitForTimeout(300);
check("one stays card per city", (await p.locator(".card").count()) >= 2);
// The add button is per-card and no longer names its city, so scope by card.
await p.click(".card:has(.segtitle:has-text('Rome')) button:has-text('Add a place')");
await p.waitForTimeout(200);
await p.fill(".tbl.stays tbody tr:first-child td:first-child input", "Hotel Artemide");
await p.fill(".tbl.stays tbody tr:first-child td:nth-child(2) input", "1200");
await p.waitForTimeout(200);
const perNight = await p.textContent(".tbl.stays tbody tr:first-child td:nth-child(3)");
check("per-night is derived from the segment's nights", perNight.replace(/\D/g, "") === String(Math.round(1200 / after[0])), { perNight, romeNights: after[0] });

await p.click(".step:has-text('Days')");
await p.waitForTimeout(300);
check("one row per trip day", (await p.locator(".day").count()) === 12);
check("day rows know their city", /Rome/.test(await p.textContent(".day:first-child")), await p.textContent(".day:first-child"));
check("every day is expanded by default", (await p.locator(".day.open").count()) === 12);
await p.click(".day:first-child button:has-text('+ ticket')");
await p.waitForTimeout(200);
await p.fill(".day:first-child .item input.bare.grow", "Colosseum");
await p.waitForTimeout(200);
check("an unbought ticket surfaces in 'still to book'", /Colosseum/.test(await p.textContent(".todo")), await p.textContent(".todo").catch(() => "no todo"));
await p.waitForTimeout(300);
const finalLayers = await layers();
check("by the last phase the ribbon carries every layer, hotels above cities",
  finalLayers.join(",") === "months,head,bars,points,bars,segments,ticks", finalLayers);
check("every day is ruled, not just weeks", (await p.locator(".ribbon .tl-weeks .dayline").count()) >= 10);
check("the days layer marks the day with an item", (await p.locator(".ribbon .tick").count()) >= 1);

console.log("\nday trips");
await p.click(".day:first-child button:has-text('+ day trip')");
await p.waitForTimeout(150);
await p.fill(".day:first-child .daytrip-edit input", "Pompeii");
await p.waitForTimeout(400);
check("the day still names the city you sleep in", (await p.textContent(".day:first-child .day-city")).includes("Rome"));
check("the day trip reads beside it", (await p.inputValue(".day:first-child .daytrip-edit input")) === "Pompeii");
check("the ribbon marks the day trip differently", (await p.locator(".ribbon .tick.daytrip").count()) === 1);
const sleeping = await p.evaluate(() => {
  const row = [...document.querySelectorAll(".ribbon .tl-row")]
    .find((r) => (r.querySelector(".tl-gutter") || {}).textContent === "Hotels");
  return row ? row.textContent : null;
});
check("the hotels layer still reads City — Hotel, untouched by the day trip",
  !!sleeping && sleeping.includes("Rome") && sleeping.includes("Hotel Artemide"), sleeping);

console.log("\nthe itinerary drawer");
/* It has to be reachable from wherever you are, it has to leave the app
   underneath usable, and — the whole reason it exists — it has to already
   show an edit by the time you look up from making it. */
check("closed to begin with", await p.evaluate(
  () => !document.querySelector(".docdrawer").classList.contains("open")));
await p.click(".link:has-text('itinerary')");
await p.waitForTimeout(400);
check("the header pulls it up", await p.evaluate(
  () => document.querySelector(".docdrawer").classList.contains("open")));
check("it is actually on screen, not just flagged open", await p.evaluate(() => {
  const r = document.querySelector(".docdrawer").getBoundingClientRect();
  return r.width > 200 && r.right <= innerWidth + 2 && r.left < innerWidth - 100;
}));
check("it renders the doc's own day headings", await p.evaluate(
  () => /DAY 1 - \w+ [A-Z]+ \d+/.test(document.querySelector(".docdrawer").textContent)),
  await p.textContent(".sd-day"));
check("there is no backdrop, so the app underneath stays usable",
  (await p.locator(".docdrawer ~ .backdrop, .sheet").count()) === 0);

/* The claim under test: no caching, no refresh, no invalidation. */
const dayLine = () => p.evaluate(() => {
  const heads = [...document.querySelectorAll(".docdrawer .sd-day")];
  const h = heads.find((x) => /OCTOBER 13/.test(x.textContent));
  const out = [];
  let n = h && h.nextElementSibling;
  while (n && n.classList.contains("sd-b")) { out.push(n.textContent); n = n.nextElementSibling; }
  return out.join(" | ");
});
const docBefore = await dayLine();
await p.click(".step:has-text('Days')");
await p.waitForTimeout(350);
await p.fill(".day:nth-child(2) .daynotes", "Ancient Rome");
await p.waitForTimeout(400);
const docAfter = await dayLine();
check("an edit shows in the drawer without reopening it",
  docAfter !== docBefore && /Ancient Rome/.test(docAfter), { docBefore, docAfter });

await p.click(".link:has-text('itinerary')");
await p.waitForTimeout(300);
check("and it folds away again", await p.evaluate(
  () => !document.querySelector(".docdrawer").classList.contains("open")));

console.log("\nlocking days");
check("days step is not done with one day filled in",
  (await p.evaluate(() => document.querySelector(".step:nth-child(5)").className)).includes("started"));
await p.click(".toolbar button:has-text('Lock all')");
await p.waitForTimeout(400);
check("days step turns done once every day is locked",
  (await p.evaluate(() => document.querySelector(".step:nth-child(5)").className)).includes("done"));
check("the counter agrees", (await p.textContent(".nightcount")).replace(/\s+/g, " ").includes("12 of 12"));

console.log("\nthe day trip shows in Cities");
await p.click(".step:has-text('Cities')");
await p.waitForTimeout(350);
check("a day-trip row appears in the list", (await p.locator(".segrow.triprow").count()) === 1);
check("it names the stop it is out of", (await p.textContent(".segrow.triprow")).includes("out of Rome"));
check("and it rides on the cities row of the calendar", (await p.locator(".ribbon .segtrip").count()) === 1);

console.log("\ntravel days and clicking the calendar");
check("the boundary between stops is drawn as a handover",
  (await p.locator(".ribbon .segmove").count()) === 1);
// Stops run midday-to-midday, so a travel day is half one city and half the next.
const halves = await p.evaluate(() => {
  const row = document.querySelector(".ribbon .seg-row");
  const cols = getComputedStyle(row).gridTemplateColumns.split(" ").length;
  const heads = document.querySelectorAll(".ribbon .tl-row.head .tl-day").length;
  const segs = [...row.querySelectorAll(".seg")].map((s) => getComputedStyle(s).gridColumnStart);
  return { cols, heads, segs };
});
check("each day is two half-columns wide", halves.cols === halves.heads * 2 + 1, halves);
check("a stop starts at midday, not at the day boundary",
  halves.segs.every((v) => (parseInt(v, 10) - 2) % 2 === 1), halves);
await p.click(".step:has-text('Days')");
await p.waitForTimeout(350);
const travelRow = await p.evaluate(() => {
  const r = [...document.querySelectorAll(".day")].find((x) => x.className.includes("travel"));
  return r ? r.querySelector(".day-head").textContent.replace(/\s+/g, " ") : null;
});
check("the travel day names both cities", !!travelRow && /Rome.*Florence/.test(travelRow), travelRow);
check("and labels it a travel day", !!travelRow && /travel day/.test(travelRow), travelRow);
const wasOpen = await p.evaluate(() => document.querySelector(".day").classList.contains("open"));
await p.click(".day:first-child .day-date");
await p.waitForTimeout(200);
check("clicking the row toggles it",
  (await p.evaluate(() => document.querySelector(".day").classList.contains("open"))) !== wasOpen);
await p.click(".step:has-text('Cities')");
await p.waitForTimeout(300);

console.log("\nclicking the calendar");
await p.click(".ribbon .point >> nth=0");
await p.waitForTimeout(250);
check("a travel leg opens its details", (await p.locator(".tl-detail").count()) === 1);
check("the details name the route", (await p.textContent(".tl-detail .det-title")).includes("ATL"));
await p.click(".tl-detail .det-close");
await p.waitForTimeout(150);
check("and close again", (await p.locator(".tl-detail").count()) === 0);
await p.click(".ribbon .seg >> nth=0");
await p.waitForTimeout(250);
check("a city opens its stop details", (await p.textContent(".tl-detail")).includes("Arrive"));
check("with the days planned inside it", /Plans|Nothing planned/.test(await p.textContent(".tl-detail")));
await p.click(".ribbon .tick >> nth=1");
await p.waitForTimeout(250);
check("a day tick opens that day", /Oct/.test(await p.textContent(".tl-detail .det-title")));
const dayText = await p.textContent(".tl-detail");
check("the day summarises where you are and what's booked",
  /Day/.test(dayText) && /(City|Cities)/.test(dayText), dayText.slice(0, 200));
await p.click(".tl-detail .det-close");
await p.waitForTimeout(150);
await p.click(".ribbon .tl-day >> nth=3");
await p.waitForTimeout(250);
check("clicking the date in the header opens the same day panel",
  (await p.locator(".tl-detail").count()) === 1 && /Oct/.test(await p.textContent(".tl-detail .det-title")));
await p.click(".tl-detail .det-close");

console.log("\ncost breakdown");
await p.click(".costbtn");
await p.waitForTimeout(250);
check("the header total opens a breakdown", (await p.locator(".costpanel").count()) === 1);
check("it splits paid from still to pay",
  /already paid/.test(await p.textContent(".costpanel")) && /still to pay/.test(await p.textContent(".costpanel")));
check("and lists the lines behind it", (await p.locator(".costpanel .tbl.costs tbody tr").count()) >= 1);
await p.click(".costpanel .det-close");
await p.waitForTimeout(150);
check("and closes", (await p.locator(".costpanel").count()) === 0);

console.log("\npersistence");
await p.waitForTimeout(2500);
const saved = await p.evaluate(() => {
  const all = window.__pub;
  for (let i = all.length - 1; i >= 0; i--) {
    const k = Object.keys(all[i]).find((x) => x.startsWith("data/trips/"));
    if (k) return JSON.parse(all[i][k]);
  }
  return null;
});
check("saved trip has the locked dates", saved && saved.dates.locked && saved.dates.start === "2026-10-12");
check("saved trip has both segments with the dragged nights", saved && saved.segments.map((s) => s.nights).join(",") === after.join(","), saved && saved.segments);
check("saved trip has the stay", saved && saved.stays.length === 1 && saved.stays[0].name === "Hotel Artemide");
check("saved trip has the day item", saved && Object.values(saved.days).some((d) => d.items.some((i) => i.title === "Colosseum")));
check("saved trip has the day trip", saved && saved.days["2026-10-12"] && saved.days["2026-10-12"].city === "Pompeii", saved && saved.days["2026-10-12"]);
check("saved trip has every day locked", saved && Object.values(saved.days).filter((d) => d.locked).length === 12);
const lastKeys = await p.evaluate(() => Object.keys(window.__pub[window.__pub.length - 1]));
check("publishes only the touched trip plus the index", lastKeys.length === 2, lastKeys);

console.log("\nseeding when there is nothing at all");
{
  const s3 = await serve(8899, {});
  const p3 = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p3.on("pageerror", (e) => errs.push("seed pageerror: " + e.message));
  await p3.addInitScript(() => { window.__pub = []; window.claude = { use: async (n) => n === "artifact" ? { publish: async (f) => { window.__pub.push(f); return { version: "v" }; } } : null }; });
  await p3.goto("http://localhost:8899/", { waitUntil: "load" });
  await p3.waitForTimeout(900);
  check("an empty desk opens onto the Italy trip", (await p3.textContent(".tripname")) === "Italy");
  check("the seeded trip carries its flight cost", /5,472/.test(await p3.textContent(".tripfoot")), await p3.textContent(".tripfoot"));
  await p3.waitForTimeout(2400);
  const seededIdx = await p3.evaluate(() => { const f = window.__pub.find((x) => x["data/index.json"]); return f ? JSON.parse(f["data/index.json"]) : null; });
  check("the seed is written out with a seeded flag", seededIdx && seededIdx.prefs.seeded === true, seededIdx && seededIdx.prefs);
  await p3.close(); s3.close();

  // An index that lists no trips is a desk emptied on purpose — leave it empty.
  const s4 = await serve(8899, { "data/index.json": JSON.stringify({ schema: 2, trips: [], prefs: { seeded: true } }) });
  const p4 = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p4.on("pageerror", (e) => errs.push("empty pageerror: " + e.message));
  await p4.addInitScript(() => { window.claude = { use: async () => null }; });
  await p4.goto("http://localhost:8899/", { waitUntil: "load" });
  await p4.waitForTimeout(800);
  check("a deliberately emptied desk is not re-seeded", (await p4.locator(".tripcard").count()) === 0);
  await p4.close(); s4.close();
}

console.log("\nreboot from the saved v2 layout");
const idx = await p.evaluate(() => {
  for (let i = window.__pub.length - 1; i >= 0; i--) if (window.__pub[i]["data/index.json"]) return window.__pub[i]["data/index.json"];
  return null;
});
const tripFile = await p.evaluate(() => {
  for (let i = window.__pub.length - 1; i >= 0; i--) {
    const k = Object.keys(window.__pub[i]).find((x) => x.startsWith("data/trips/"));
    if (k) return { k, v: window.__pub[i][k] };
  }
  return null;
});
server.close();
const server2 = await serve(8811, { "data/index.json": idx, [tripFile.k]: tripFile.v });
const p2 = await b.newPage({ viewport: { width: 1280, height: 1500 } });
p2.on("pageerror", (e) => errs.push("reboot pageerror: " + e.message));
await p2.addInitScript(() => { window.__pub = []; window.claude = { use: async () => null }; });
await p2.goto("http://localhost:8811/", { waitUntil: "load" });
await p2.waitForTimeout(900);
check("reboot finds the trip", (await p2.locator(".tripcard").count()) === 1);
check("reboot shows all five phase dots progressed", (await p2.locator(".phasedots .dot.is-done, .phasedots .dot.is-started").count()) >= 4);
await p2.click(".tripmain");
await p2.click(".step:has-text('Cities')");
await p2.waitForTimeout(400);
check("reboot restores the dragged nights", (await p2.evaluate(() => [...document.querySelectorAll(".segnights .num")].map((x) => x.textContent))).join(",") === after.map((n) => n + "n").join(","));

console.log("\na night in the air is not an arrival");
/* Served rather than clicked into place, because the scenario has to be exact:
   the trip must start on the outbound date, and the first stop must own the
   single night the plane is in the air. Driving the UI into that state was
   fragile enough to skip itself silently, which is worse than not testing it.

   The bug this pins: the row said "Arrive Oct 10" of a night nobody arrives
   anywhere on, and a stop named for its destination then read as that city
   starting a day before the calendar above said it did. */
const REDEYE = JSON.stringify({
  schema: 2, id: "trip_red", name: "Italy", createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z", travelers: 2,
  window: { start: "2026-10-10", end: "2026-10-25" },
  target: { minNights: 3, maxNights: 21 },
  dates: { start: "2026-10-10", end: "2026-10-14", locked: true },
  holidays: [], homeAirports: "ATL", destAirports: "FCO",
  flights: {
    options: [{
      id: "o1", name: "Delta", status: "Booked", priceEach: "1402", fares: [], checks: [],
      out: { date: "2026-10-10", from: "ATL", to: "FCO", depart: "16:35", arrive: "07:35", plusOne: true, stops: "nonstop", carrier: "Delta", flight: "DL 214", dur: "9h" },
      ret: { date: "2026-10-14", from: "FCO", to: "ATL", depart: "09:05", arrive: "14:39", plusOne: false, stops: "nonstop", carrier: "Delta", flight: "DL 279", dur: "11h" },
    }],
    bookedId: "o1", booking: { ref: "ABC123", paidTotal: "2804", currency: "USD", url: "", notes: "" },
  },
  travel: [], baseCurrency: "USD", rates: {},
  segments: [
    { id: "sa", city: "Overnight to Rome", nights: 1, locked: true },
    { id: "sb", city: "Rome", nights: 3, locked: true },
  ],
  stays: [], days: {},
  source: { kind: "", docUrl: "", docTitle: "", syncedAt: "", syncedBy: "", text: "", fields: {} },
});
const server3 = await serve(8812, {
  "data/index.json": JSON.stringify({ schema: 2, order: ["trip_red"], trips: [{ id: "trip_red", name: "Italy" }], prefs: {} }),
  "data/trips/trip_red.json": REDEYE,
});
const p3 = await b.newPage({ viewport: { width: 1280, height: 1100 } });
p3.on("pageerror", (e) => errs.push("redeye pageerror: " + e.message));
await p3.addInitScript(() => { window.__pub = []; window.claude = { use: async () => null }; });
await p3.goto("http://localhost:8812/", { waitUntil: "load" });
await p3.waitForTimeout(900);
await p3.click(".tripmain");
await p3.waitForTimeout(400);
await p3.click(".step:has-text('Cities')");
await p3.waitForTimeout(400);

const rowText = (city) => p3.evaluate((c) => {
  const r = [...document.querySelectorAll(".segrow")]
    .find((x) => (x.querySelector(".segcity") || {}).value === c);
  return r ? r.querySelector(".segdates").textContent.replace(/\s+/g, " ").trim() : null;
}, city);

const air = await rowText("Overnight to Rome");
check("the transit stop says it is in the air, not that you arrived",
  !!air && /In the air/.test(air) && !/Arrive/.test(air), air);
check("and it still shows both ends of the night", !!air && /Oct 10/.test(air) && /Oct 11/.test(air), air);

const rome = await rowText("Rome");
check("the city after it reads as a normal arrival, on the day the calendar says",
  !!rome && /Arrive/.test(rome) && /Oct 11/.test(rome), rome);

check("no day trip is offered out of a plane", await p3.evaluate(() => {
  const r = [...document.querySelectorAll(".segrow")].find((x) => /In the air/.test(x.textContent));
  const btn = r && [...r.querySelectorAll("button")].find((x) => /day trip/i.test(x.textContent));
  return !!btn && btn.disabled;
}));
check("but the real city still offers one", await p3.evaluate(() => {
  const r = [...document.querySelectorAll(".segrow")].find((x) => /Arrive/.test(x.textContent));
  const btn = r && [...r.querySelectorAll("button")].find((x) => /day trip/i.test(x.textContent));
  return !!btn && !btn.disabled;
}));
server3.close();

await p.screenshot({ path: "shot-days.png", fullPage: true });
await p2.screenshot({ path: "shot-trips.png", fullPage: true });
console.log(errs.length ? "\nERRORS:\n" + errs.join("\n") : "\nno console errors");
console.log(fails ? `\n${fails} CHECKS FAILED\n` : "\nall checks passed\n");
await b.close(); server2.close();
process.exitCode = fails ? 1 : 0;
