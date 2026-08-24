/* Smoke test for the hosted build: the bundle boots, the gate renders, and the
   PWA files are well formed. Firebase itself is not stubbed — an unconfigured
   build is exactly the state that proves the whole boot path runs. */
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

/* Playwright finds its own browser. PW_CHROME overrides that for sandboxes
   that keep browsers outside the standard cache — which is where the absolute
   Linux path that used to live here came from. */
const CHROME = process.env.PW_CHROME;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json" };

const server = await new Promise((r) => {
  const s = http.createServer(async (req, res) => {
    let f = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html";
    try {
      const body = await readFile(path.join("docs", f));
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("no"); }
  });
  s.listen(8833, () => r(s));
});

let fails = 0;
const errs = [];
const check = (n, c, extra) => {
  if (c) console.log("  ok  " + n);
  else { console.log(" FAIL " + n + (extra ? "\n       " + JSON.stringify(extra).slice(0, 300) : "")); fails++; }
};

const b = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon|sw\.js|ServiceWorker/i.test(m.text())) errs.push("console: " + m.text()); });

await p.goto("http://localhost:8833/", { waitUntil: "load" });
await p.waitForTimeout(1200);

console.log("\nhosted build boots");
check("the Firebase bundle loads without throwing", errs.length === 0, errs);
check("it renders the sign-in gate, not the desk", (await p.locator(".signin").count()) === 1);
check("no trips leak before sign-in", (await p.locator(".tripcard").count()) === 0);
/* The gate's copy depends on whether this build received a Firebase config,
   and both states are worth asserting. Detect which one we are looking at from
   the same file the build itself read, rather than assuming — this test used to
   assume "unconfigured" and quietly went stale the day the project was
   configured. */
let configured = false;
try { JSON.parse(await readFile("firebase.config.json", "utf8")); configured = true; } catch {}

const gate = await p.textContent(".signin");
const disabled = await p.evaluate(() => document.querySelector(".signin .btn-solid").disabled);

if (configured) {
  check("a configured build offers a live sign-in", !/no Firebase project/i.test(gate), gate);
  check("and the button is not disabled", disabled === false);
} else {
  check("an unconfigured build says so plainly", /no Firebase project/i.test(gate), gate);
  check("and disables the button rather than failing on click", disabled === true);
}

/* The redirect flow cannot complete in this deployment: the app is served from
   github.io while the auth handler lives on <project>.firebaseapp.com, and
   modern browsers partition the storage the handler needs to match its result
   against the pending sign-in. It fails by stranding you on a blank page
   holding a valid Google authorisation code — the least debuggable failure
   available — so the call must not come back. */
const bundle = await (await fetch("http://localhost:8833/index.html")).text();
check("sign-in does not fall back to the redirect flow", !/signInWithRedirect\s*\(/.test(bundle));

console.log("\npwa");
const man = JSON.parse(await (await fetch("http://localhost:8833/manifest.webmanifest")).text());
check("manifest names the app and can be installed",
  man.name === "Trip Desk" && man.display === "standalone" && man.start_url === ".");
check("it declares all three icons", man.icons.length === 3 && man.icons.some((i) => i.purpose === "maskable"));
for (const i of man.icons) {
  const r = await fetch("http://localhost:8833/" + i.src);
  check(`${i.src} is actually there`, r.ok && r.headers.get("content-type") === "image/png");
}
const sw = await (await fetch("http://localhost:8833/sw.js")).text();
check("the worker versions its cache", /tripdesk-shell-[0-9a-f]{12}/.test(sw));
check("it leaves cross-origin requests alone (Firebase must not be cached)",
  /url\.origin !== self\.location\.origin/.test(sw));
check("it serves the shell on navigation", /mode === "navigate"/.test(sw));
const head = await (await fetch("http://localhost:8833/index.html")).text();
check("the document declares a viewport and theme colour",
  /viewport/.test(head) && /theme-color/.test(head));
check("it registers the worker", /serviceWorker/.test(head));

console.log(errs.length ? "\nERRORS:\n" + errs.join("\n") : "");
console.log(fails ? `\n${fails} CHECKS FAILED\n` : "\nall checks passed\n");
await b.close(); server.close();
process.exitCode = fails ? 1 : 0;
