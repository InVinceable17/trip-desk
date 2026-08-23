import http from "node:http";
import { readFile } from "node:fs/promises";
export function serve(port = 8811, files = {}) {
  const s = http.createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "");
    if (!url || url === "index.html") {
      const body = await readFile("dist/artifact.html", "utf8");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`);
      return;
    }
    if (files[url] != null) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(files[url]);
      return;
    }
    res.writeHead(404); res.end("not found");
  });
  return new Promise((r) => s.listen(port, () => r(s)));
}
