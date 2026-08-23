/* Bundle React + the app into one inline <script>, then inject it into the
   page template. Artifacts block CDNs, so nothing may be fetched at runtime. */
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const out = await build({
  entryPoints: ["src/app.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  jsx: "transform",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
  legalComments: "none",
});

const js = out.outputFiles[0].text;
const tpl = await readFile("src/page.html", "utf8");

if (!tpl.includes("/*__BUNDLE__*/")) throw new Error("template lost its bundle marker");
// </script> inside the bundle would close the tag early.
const safe = js.replace(/<\/script>/gi, "<\\/script>");
const html = tpl.replace("/*__BUNDLE__*/", () => safe);

await mkdir("dist", { recursive: true });
await writeFile("dist/artifact.html", html);
console.log(`dist/artifact.html  ${(html.length / 1024).toFixed(0)} KB  (js ${(js.length / 1024).toFixed(0)} KB)`);
