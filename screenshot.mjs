// node screenshot.mjs <url> [label] [width] [height] [fullPage:0|1] [scrollY]
// Saves to "./temporary screenshots/screenshot-N[-label].png"
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import os from 'node:os';

const require = createRequire(process.env.PUPPETEER_DIR ? join(process.env.PUPPETEER_DIR, 'x.js') : import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer'); } catch { puppeteer = require('puppeteer-core'); }

const [url = 'http://localhost:3000', label = '', w = '1440', h = '900', full = '1', scrollY = '0'] = process.argv.slice(2);

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(os.homedir(), '.cache/puppeteer/chrome');
  if (!existsSync(base)) return undefined;
  const v = readdirSync(base).sort().reverse()[0];
  const mac = join(base, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  const mac64 = mac.replace('mac-arm64', 'mac-x64');
  const win = join(base, v, 'chrome-win64/chrome.exe');
  return [mac, mac64, win].find(existsSync);
}

const dir = 'temporary screenshots';
await mkdir(dir, { recursive: true });
const n = (await readdir(dir)).filter(f => f.startsWith('screenshot-')).length + 1;
const out = join(dir, `screenshot-${n}${label ? '-' + label : ''}.png`);

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(async () => { await document.fonts.ready; });
if (+scrollY) await page.evaluate(y => window.scrollTo(0, y), +scrollY);
await new Promise(r => setTimeout(r, 2800));
await page.screenshot({ path: out, fullPage: full === '1' });
await browser.close();
console.log(out);
