'use strict';

/* The PNG favicons, drawn from public/brand/icon.svg by Chromium so they
   match the SVG exactly. Run after scripts/make-brand.py:

     node scripts/make-brand-png.js [preview-dir]

   Needs Playwright and a Chromium (PLAYWRIGHT_BROWSERS_PATH, or pass
   CHROME=/path/to/chrome). The 32px favicon is the tight tab icon
   (icon.svg); the 180px apple-touch icon is the roomier TOUCH_ICON. With a
   preview directory it also writes previews there, for looking at — those
   are not part of the site. */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'public', 'brand');
const svg = f => fs.readFileSync(path.join(OUT, f), 'utf8');
/* The home-screen icon has more room than the tab icon, and is only ever
   a PNG, so it comes from site/brand-svg.js rather than a file. */
const { TOUCH_ICON } = require('../site/brand-svg.js');

async function shoot(page, html, w, h, file) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h }, omitBackground: false });
  console.log('wrote ' + path.relative(process.cwd(), file) + ' (' + w + 'x' + h + ')');
}

(async () => {
  const exe = process.env.CHROME ||
    (fs.existsSync('/opt/pw-browsers') && fs.readdirSync('/opt/pw-browsers')
      .filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0]);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage();
  const fill = s => s.replace('<svg ', '<svg style="display:block;width:100%;height:100%" ');

  await shoot(page, fill(svg('icon.svg')), 32, 32, path.join(OUT, 'favicon-32.png'));
  await shoot(page, fill(TOUCH_ICON), 180, 180, path.join(OUT, 'apple-touch-icon.png'));

  const preview = process.argv[2];
  if (preview) {
    fs.mkdirSync(preview, { recursive: true });
    await shoot(page, `<div style="background:#F4EFE6;width:1600px;height:480px;display:flex;align-items:center;justify-content:center">
      <div style="width:1300px">${fill(svg('wordmark.svg'))}</div></div>`, 1600, 480, path.join(preview, 'wordmark.png'));
    await shoot(page, fill(svg('icon.svg')), 512, 512, path.join(preview, 'icon.png'));
    await shoot(page, `<div style="background:#F4EFE6;width:420px;height:150px;padding:28px 20px;box-sizing:border-box">
      ${svg('wordmark.svg').replace('<svg ', '<svg style="display:block;height:32px;width:auto;margin-bottom:26px" ')}
      ${svg('wordmark.svg').replace('<svg ', '<svg style="display:block;height:15px;width:auto" ')}</div>`,
      420, 150, path.join(preview, 'wordmark-header-sizes.png'));
    await shoot(page, `<div style="background:#fff;padding:24px;display:flex;gap:28px;align-items:center;font:14px sans-serif">
      <img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, 'favicon-32.png')).toString('base64')}" width="32" height="32"> 32px
      <img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, 'favicon-32.png')).toString('base64')}" width="16" height="16"> 16px
      <img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, 'apple-touch-icon.png')).toString('base64')}" width="180" height="180"> 180px</div>`,
      420, 230, path.join(preview, 'favicons.png'));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
