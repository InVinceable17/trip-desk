/* ============================================================================
   scrape.js — the Browserless layer.

   The original drove Browserless by asking Claude to "run exactly this
   JavaScript", then asking it to read the result. Neither half is needed: the
   page calls the viewer's Browserless connector directly through the `mcp`
   capability, and parsers.js reads the text.

   Constraint that shapes everything here: this Browserless plan caps a session
   at 60 seconds, so each stage is one page load in one call.
   ========================================================================== */

import { parseFares, parseSearchRows, parseFlightNo } from "./parsers.js";
import { to12h, legOk, searchUrl, partialUrl, fareUrlFrom, flightParts } from "./flights.js";

const SERVER = "Browserless";
const TOOL = "browserless_function";
const TIMEOUT = 55000;

/* The connector echoes whatever the function returned, sometimes as a parsed
   object and sometimes as text with a trailing metadata footer. Accept both. */
export function unwrap(payload) {
  let p = payload;
  if (typeof p === "string") {
    const m = p.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { p = JSON.parse(m[0]); } catch { return null; }
  }
  if (p && typeof p === "object" && "data" in p) p = p.data;
  return p;
}

/* Shared preamble. Polls for the structure the stage needs rather than for a
   dollar sign — the original's `/\$\d/ && /hr/` test matches while the page
   still says "Loading results", which produced real empty reads. */
const PAGE = (url, readyExpr, tail) => `export default async ({ page }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await page.setViewport({ width: 1440, height: 1600 });
  await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded", timeout: 25000 });
  let ready = false;
  for (let i = 0; i < 14; i++) {
    await sleep(1200);
    ready = await page.evaluate(() => { try { return (${readyExpr}); } catch (e) { return false; } });
    if (ready) break;
  }
${tail}
};`;

/* Result rows are <li> elements carrying a time and a price. */
const ROWS_READY = `[...document.querySelectorAll("li")].filter(function (l) {
  var t = l.innerText || "";
  return /\\d:\\d\\d\\s?(AM|PM)/.test(t) && /\\$\\d/.test(t);
}).length > 0`;

const ROWS_TAIL = `  const rows = await page.evaluate(() => [...document.querySelectorAll("li")]
    .map((l) => l.innerText || "")
    .filter((t) => /\\d:\\d\\d\\s?(AM|PM)/.test(t) && /\\$\\d/.test(t))
    .slice(0, 30));
  return { data: { ready, rows }, type: "application/json" };`;

const codeScanSearch = (url) => PAGE(url, ROWS_READY, ROWS_TAIL);

const codeExpandRow = (url, want) => PAGE(url, ROWS_READY, `  const want = ${JSON.stringify(want)};
  const clicked = await page.evaluate((w) => {
    const hit = [...document.querySelectorAll("li")].find((r) => (r.innerText || "").includes(w));
    if (!hit) return "no-row";
    const b = [...hit.querySelectorAll("button")].find((x) => /detail/i.test(x.getAttribute("aria-label") || ""));
    if (!b) return "no-button";
    b.click();
    return "ok";
  }, want);
  await sleep(3000);
  const text = await page.evaluate((w) => {
    const hit = [...document.querySelectorAll("li")].find((r) => (r.innerText || "").includes(w));
    return hit ? hit.innerText : "";
  }, want);
  return { data: { ready, clicked, text: text.slice(0, 2000) }, type: "application/json" };`);

const FARES_READY = `/Booking options/.test(document.body.innerText) && /\\$\\d/.test(document.body.innerText)`;

const codeFares = (url) => PAGE(url, FARES_READY, `  const t = await page.evaluate(() => document.body.innerText);
  const i = t.search(/Booking options/);
  return { data: { ready, text: i > -1 ? t.slice(i, i + 5000) : t.slice(0, 2000) }, type: "application/json" };`);

/* ------------------------------------------------------------ call layer */

/** Human copy per MCP error code. Each one names the action that fixes it. */
export function describeMcpError(e) {
  const code = (e && e.code) || "upstream_error";
  switch (code) {
    case "needs_reauth":
      return { msg: "Browserless needs reconnecting — claude.ai Settings → Connectors.", retry: false };
    case "server_not_connected":
      return { msg: "No Browserless connector on this account — add it in claude.ai Settings → Connectors.", retry: false };
    case "selection_required":
      return { msg: "You have more than one Browserless connector. Pick one when claude.ai asks.", retry: false };
    case "server_unavailable":
      return { msg: "Browserless didn't answer. Try again in a moment.", retry: true };
    case "not_in_manifest":
      return { msg: "This page isn't allowed to call that tool.", retry: false };
    case "blocked_by_policy":
      return { msg: "Your organization blocks this connector.", retry: false };
    case "approval_required":
      return { msg: "This connector needs per-call approval, which artifacts can't request yet.", retry: false };
    case "tool_error":
      return { msg: `Browserless ran but failed: ${(e && e.message) || "no detail"}`, retry: false };
    case "rate_limited":
      return { msg: "Too many checks too quickly. Give it a minute.", retry: false };
    case "not_granted":
    case "capability_disabled":
    case "capability_removed":
      return { msg: "Price checks aren't available in this view.", retry: false };
    case "bad_request":
    case "transform_error":
      return { msg: "The page built a bad request — that's a bug worth reporting.", retry: false };
    case "cancelled":
      return { msg: "Cancelled. The check may have run anyway.", retry: false };
    default:
      return { msg: "Browserless couldn't be reached.", retry: true };
  }
}

/** An error this module produced, whose message is already reader-ready. */
const fail = (msg) => Object.assign(new Error(msg), { friendly: true });

/** One place that turns any thrown thing into copy for the user. */
export const errText = (e) =>
  e && e.friendly ? e.message
    : e && e.code ? describeMcpError(e).msg
    : (e && e.message) || "Something went wrong.";

async function runStage(mcp, code) {
  const res = await mcp.callTool(SERVER, TOOL, { code, timeout: TIMEOUT }, { cache: false });
  const data = unwrap(res && res.payload);
  if (!data) throw fail("Browserless returned nothing readable.");
  return data;
}

/* -------------------------------------------------------------- stages */

/** Load a search URL and return its result rows, parsed. */
export async function scanSearch(mcp, url) {
  const d = await runStage(mcp, codeScanSearch(url));
  const rows = parseSearchRows(d.rows || []);
  if (!rows.length) {
    throw fail(d.ready
      ? "Google Flights returned no flights for those dates."
      : "Google Flights didn't finish loading in time. Try again.");
  }
  return rows;
}

/** Expand the row departing at `depart24` and read its operating flight number. */
export async function resolveFlightNo(mcp, url, depart24, preferCode) {
  const want = to12h(depart24);
  if (!want) throw fail("That leg has no departure time to match on.");
  const d = await runStage(mcp, codeExpandRow(url, want));
  if (d.clicked === "no-row") {
    throw fail(`No flight leaving at ${want} on that page — the schedule may have changed.`);
  }
  const f = parseFlightNo(d.text, preferCode);
  if (!f) throw fail("Couldn't read a flight number from that row.");
  return f;
}

/** Load a both-legs-chosen URL and read the fare ladder. */
export async function readFares(mcp, url, airline) {
  const d = await runStage(mcp, codeFares(url));
  const { fares, airline: got } = parseFares(d.text || "", airline);
  if (!fares.length) {
    throw fail(d.ready
      ? "No named fare brands on that booking page — only a single unbranded price."
      : "The booking page didn't finish loading in time. Try again.");
  }
  return { fares, airline: got };
}

/* --------------------------------------------------------- the pipeline */
/* Warm (both flight numbers cached): one call.
   Cold: one call per missing leg to resolve its number, then the fares call. */

export function callCost(option) {
  if (!legOk(option.out)) return 0;
  let n = 1;
  if (!flightParts(option.out)) n++;
  if (legOk(option.ret) && !flightParts(option.ret)) n++;
  return n;
}

export async function checkPrice(mcp, option, onStage) {
  if (!legOk(option.out)) {
    return { error: "Add a date and two 3-letter airport codes first." };
  }
  const say = onStage || (() => {});
  try {
    let a = flightParts(option.out);
    let b = legOk(option.ret) ? flightParts(option.ret) : null;
    const bothLegs = legOk(option.ret);

    if (!a) {
      say("finding outbound flight no.");
      a = await resolveFlightNo(mcp, searchUrl(option), option.out.depart, (option.out.carrier || "").slice(0, 2));
    }
    if (bothLegs && !b) {
      say("finding return flight no.");
      b = await resolveFlightNo(mcp, partialUrl(option, a), option.ret.depart, (option.ret.carrier || "").slice(0, 2));
    }

    say("reading fares");
    const url = fareUrlFrom(option, a, bothLegs ? b : null);
    const { fares } = await readFares(mcp, url, option.bookVia || option.out.carrier);

    return { fares, found: { out: `${a.code} ${a.num}`, ret: b ? `${b.code} ${b.num}` : "" } };
  } catch (e) {
    return { error: errText(e) };
  }
}
