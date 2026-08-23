/* ============================================================================
   Build the hosted version: a static site for GitHub Pages, backed by
   Firestore, installable and usable offline.

   Differences from the artifact build (build.mjs):
     - `./backend.js` resolves to store-firebase.js instead of store-artifact.js
     - the Firebase config is inlined from firebase.config.json
     - it emits a full HTML document, a manifest, icons and a service worker
       rather than a fragment for the artifact shell
   ========================================================================== */
import { build } from "esbuild";
import { readFile, writeFile, mkdir, cp, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const OUT = "docs";                      // GitHub Pages serves /docs on main
const ROOT = process.cwd();

/* The config identifies the Firebase project. It is public by design — the
   security rules are what actually protect the data. */
let config = null;
try {
  config = JSON.parse(await readFile("firebase.config.json", "utf8"));
} catch (err) {
  if (err.code === "ENOENT") {
    /* A legitimate mode: the artifact build needs no Firebase at all. */
    console.warn("! firebase.config.json missing — building an unconfigured shell.");
  } else {
    /* Not a mode, a mistake. Failing loudly here is the whole point: a syntax
       error used to land in the same branch as a missing file, so the build
       succeeded and shipped an app with no backend. The Firebase console hands
       you a JavaScript object literal, whose keys are unquoted and therefore
       not JSON. */
    console.error(`✗ firebase.config.json is present but not valid JSON: ${err.message}`);
    console.error("  The console gives you a JS object literal — quote the keys.");
    console.error("  See firebase.config.example.json for the exact shape.");
    process.exit(1);
  }
}

/* Point `./backend.js` at Firestore for this target only. */
const useFirestore = {
  name: "firestore-backend",
  setup(b) {
    b.onResolve({ filter: /^\.\/backend\.js$/ }, () => ({
      path: path.resolve(ROOT, "src/store-firebase.js"),
    }));
  },
};

const out = await build({
  entryPoints: ["src/app.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  jsx: "transform",
  define: {
    "process.env.NODE_ENV": '"production"',
    __FIREBASE_CONFIG__: JSON.stringify(config),
  },
  plugins: [useFirestore],
  write: false,
  legalComments: "none",
});

const js = out.outputFiles[0].text;
const body = await readFile("src/page.html", "utf8");
if (!body.includes("/*__BUNDLE__*/")) throw new Error("template lost its bundle marker");
const safe = js.replace(/<\/script>/gi, "<\\/script>");
const inner = body.replace("/*__BUNDLE__*/", () => safe);

/* The artifact host supplies the document skeleton; here we write our own. */
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0E6E75" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D1418" media="(prefers-color-scheme: dark)">
<meta name="description" content="Trip planner — dates, transport, cities, hotels and day-by-day itineraries.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png" sizes="192x192">
<link rel="apple-touch-icon" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Trip Desk">
</head>
<body>
${inner}
<script>
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
</script>
</body>
</html>
`;

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "index.html"), html);

/* Pages would otherwise run the output through Jekyll. */
await writeFile(path.join(OUT, ".nojekyll"), "");

await writeFile(path.join(OUT, "manifest.webmanifest"), JSON.stringify({
  name: "Trip Desk",
  short_name: "Trip Desk",
  description: "Plan a trip: dates, transport, cities, hotels, days.",
  start_url: ".",
  scope: ".",
  display: "standalone",
  orientation: "any",
  background_color: "#E9EEF2",
  theme_color: "#0E6E75",
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2));

for (const icon of ["icon-192.png", "icon-512.png", "icon-maskable.png"]) {
  try {
    await access(path.join("assets", icon));
    await cp(path.join("assets", icon), path.join(OUT, icon));
  } catch { console.warn(`! assets/${icon} missing — run "node make-icons.mjs"`); }
}

/* The shell is cached under a hash of itself, so a rebuild invalidates it and
   a rebuild that changes nothing does not. Firestore handles the data offline
   on its own; the worker only has to keep the app itself launchable. */
const version = createHash("sha256").update(html).digest("hex").slice(0, 12);
await writeFile(path.join(OUT, "sw.js"), `/* generated by build-web.mjs */
const SHELL = ${JSON.stringify(`tripdesk-shell-${version}`)};
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* Navigations: serve the cached shell straight away, refresh it behind you.
   Never intercept Firebase — its SDK does its own offline handling and a
   cached auth or Firestore response would be actively harmful. */
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  if (e.request.mode === "navigate") {
    e.respondWith(
      caches.match("./index.html").then((hit) => {
        const live = fetch(e.request)
          .then((res) => { caches.open(SHELL).then((c) => c.put("./index.html", res.clone())); return res; })
          .catch(() => hit);
        return hit || live;
      }),
    );
    return;
  }

  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
`);

console.log(`${OUT}/index.html  ${(html.length / 1024).toFixed(0)} KB  (js ${(js.length / 1024).toFixed(0)} KB)  shell ${version}`);
console.log(config ? `configured for Firebase project "${config.projectId}"` : "NOT configured — add firebase.config.json");
