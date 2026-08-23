/* App icons, rendered from the same mark the header uses so the home-screen
   icon and the page agree. Chromium is already here for the tests, so it does
   the rasterising rather than pulling in an image library. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const svg = (size, maskable) => {
  const pad = maskable ? size * 0.18 : size * 0.10;   // maskable icons get cropped
  const inner = size - pad * 2;
  const r = maskable ? size * 0.5 : size * 0.22;
  const bar = inner * 0.16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : r}" fill="#0E6E75"/>
  <g transform="translate(${pad} ${pad})">
    <rect x="0" y="${inner * 0.16}" width="${inner}" height="${bar}" rx="${bar / 2}" fill="#FFFFFF" opacity="0.95"/>
    <rect x="0" y="${inner * 0.42}" width="${inner * 0.62}" height="${bar}" rx="${bar / 2}" fill="#FFFFFF" opacity="0.65"/>
    <rect x="${inner * 0.68}" y="${inner * 0.42}" width="${inner * 0.32}" height="${bar}" rx="${bar / 2}" fill="#FFFFFF" opacity="0.35"/>
    <rect x="0" y="${inner * 0.68}" width="${inner * 0.34}" height="${bar}" rx="${bar / 2}" fill="#FFFFFF" opacity="0.5"/>
    <rect x="${inner * 0.40}" y="${inner * 0.68}" width="${inner * 0.60}" height="${bar}" rx="${bar / 2}" fill="#FFFFFF" opacity="0.8"/>
  </g>
</svg>`;
};

await mkdir("assets", { recursive: true });
const b = await chromium.launch({ executablePath: CHROME });

for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable.png", 512, true],
]) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0">${svg(size, maskable)}</body>`);
  await p.screenshot({ path: `assets/${name}`, omitBackground: false });
  await p.close();
  console.log(`assets/${name}`);
}
await b.close();
await writeFile("assets/icon.svg", svg(512, false));
