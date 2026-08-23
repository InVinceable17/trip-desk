/* Smoke test for the hosted build: the bundle boots, the gate renders, and the
   PWA files are well formed. Firebase itself is not stubbed — an unconfigured
   build is exactly the state that proves the whole boot path runs. */
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
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

const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon|sw\.js|ServiceWorker/i.test(m.text())) errs.push("console: " + m.text()); });

await p.goto("http://localhost:8833/", { waitUntil: "load" });
await p.waitForTimeout(1200);

console.log("\nhosted build boots");
check("the Firebase bundle loads without throwing", errs.length === 0, errs);
check("it renders the sign-in gate, not the desk", (await p.locator(".signin").count()) === 1);
check("no trips leak before sign-in", (await p.locator(".tripcard").count()) === 0);
check("an unconfigured build says so plainly",
  /no Firebase project/i.test(await p.textContent(".signin")), await p.textContent(".signin"));
check("and disables the button rather than failing on click",
  await p.evaluate(() => document.querySelector(".signin .btn-solid").disabled));

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
