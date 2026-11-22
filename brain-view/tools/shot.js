#!/usr/bin/env node
/* Render the built page headlessly and capture frames at exact animation times.
   usage: node tools/shot.js <page.html> <outDir> <scenario> [width height dpr] */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [page_, outDir, scenario = 'main', w = '1440', h = '810', dpr = '1'] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + path.resolve(page_) + '?capture');
  await page.waitForFunction(() => window.__brain || document.querySelector('#err').style.display === 'flex', null, { timeout: 30000 });
  const ok = await page.evaluate(() => !!window.__brain);
  if (!ok) { console.log('ENGINE FAILED:', await page.evaluate(() => document.querySelector('#err').innerText), errors); await browser.close(); process.exit(1); }
  await page.evaluate(() => { const e = window.__brain.eng; e.manual(1 / 10); e.replayIntro(); e.state.time = 0; });
  let now = 0;
  const to = async (t) => { const n = Math.max(0, Math.round((t - now) * 10)); if (n) await page.evaluate((n) => window.__brain.eng.step(n), n); now += n / 10; };
  const step = async (n = 1) => { await page.evaluate((n) => window.__brain.eng.step(n), n); now += n / 10; };
  const shot = async (name) => { await step(1); await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('shot', name, 't=' + now.toFixed(2)); };
  const S = {
    async intro() { for (const t of [0.3, 0.6, 1.0, 1.3, 1.6, 1.9, 2.2, 2.6]) { await to(t); await shot('intro_' + t.toFixed(1)); } },
    async ui() { await to(4.0); await shot('ui_4.0'); },
    async back() { await to(9.0); await shot('t09.0_back'); },
    async side() { await to(13.0); await shot('t13.0_side'); },
    async main() {
      await to(4.2); await shot('t04.2_three_quarter');
      await to(9.0); await shot('t09.0_back');
      await to(13.0); await shot('t13.0_side');
      await to(17.0); await shot('t17.0_front');
    },
    async filter() {
      await to(6.0); await page.click('.area >> nth=0'); await to(6.9); await shot('filter_school');
      await page.click('.area >> text=Body & Health'); await to(8.0); await shot('filter_body');
      await page.click('#showAll'); await to(9.0); await shot('filter_cleared');
    },
    async color() {
      await to(9.0);
      await page.click('.sw >> nth=5'); await to(10.0); await shot('color_blue');
      await page.click('.sw >> nth=4'); await to(10.8); await shot('color_cyan');
      await page.selectOption('#selColor', 'time'); await to(11.5); await shot('color_time');
      await page.selectOption('#selColor', 'area'); await to(12.2); await shot('color_area');
      await page.click('.sw >> nth=0'); await to(13.0); await shot('color_red_again');
    },
    async clusters() {
      await to(13.6);
      const set = (v) => page.evaluate((v) => { const s = document.querySelector('#sForm'); s.value = v; s.dispatchEvent(new Event('input')); }, v);
      await set(430); await to(14.2); await shot('form_043');
      await set(760); await to(14.6); await shot('form_076');
      await set(1000); await to(15.2); await shot('form_100');
      await set(0); await to(17.2); await shot('form_back');
    },
    async galaxy() {
      await to(5.0); await page.click('#galaxyBtn');
      await to(6.2); await shot('galaxy_mid');
      await to(8.4); await shot('galaxy_on');
      await to(11.0); await shot('galaxy_turned');
      await page.keyboard.press('Space'); await to(12.3); await shot('galaxy_back_mid');
      await to(14.2); await shot('galaxy_off');
    },
    async extras() {
      await to(5);
      await page.click('.tg[data-k=labels]'); await page.click('.tg[data-k=showLinks]'); await to(5.5); await shot('labels_links');
      await page.fill('#q', process.env.Q || 'business'); await to(6.2); await shot('search');
      await page.fill('#q', ''); await page.mouse.move(700, 190); await step(3); await shot('hover');
      await page.mouse.click(700, 190); await to(7.5); await shot('note_open');
      await page.evaluate(() => { const s = document.querySelector('#sSpread'); s.value = 60; s.dispatchEvent(new Event('input')); }); await to(8.5); await shot('spread_60');
    }
  };
  for (const name of scenario.split(',')) { if (!S[name]) throw new Error('unknown scenario ' + name); await S[name](); }
  if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 8));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
