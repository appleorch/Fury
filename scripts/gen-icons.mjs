// Renders scripts/icon.svg to the PNG icons in public/. Uses the Playwright that ships with the dev environment.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright is resolved from NODE_PATH (globally installed), so it is not a project dependency.
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
// Maskable icons need the artwork inside the central 80% safe zone.
const maskable = svg.replace('<g id="mark">', '<g id="mark" transform="translate(51.2 51.2) scale(0.8)">');
const out = (p) => new URL(`../public/${p}`, import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(src, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}">`);
  await page.waitForTimeout(50);
  writeFileSync(out(file), await page.screenshot({ omitBackground: true }));
}
await render(svg, 180, 'apple-touch-icon.png');
await render(svg, 192, 'icons/icon-192.png');
await render(svg, 512, 'icons/icon-512.png');
await render(maskable, 512, 'icons/icon-maskable-512.png');
await browser.close();
// Favicon: same artwork with rounded corners.
writeFileSync(out('favicon.svg'), svg.replace('<rect width="512" height="512" fill="url(#bg)"/>', '<rect width="512" height="512" rx="112" fill="url(#bg)"/>').replace('<rect width="512" height="512" fill="url(#glow)"/>', '<rect width="512" height="512" rx="112" fill="url(#glow)"/>'));
console.log('icons written');
