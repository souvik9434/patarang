import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const fr = page.frames().find((f) => f.url().includes('/canvas/'));
const info = await fr.evaluate(`(() => {
  const c = document.querySelector('.slide-container');
  const cr = c.getBoundingClientRect();
  const kicker = document.querySelector('[data-sf-id="kicker"]');
  const point0 = document.querySelector('[data-sf-id="point0"]');
  const kr = kicker.getBoundingClientRect();
  const pr = point0.getBoundingClientRect();
  return {
    containerPadding: getComputedStyle(c).padding,
    containerPosition: getComputedStyle(c).position,
    kickerLeft: kicker.style.left,
    kickerRect: { x: kr.left - cr.left, y: kr.top - cr.top, w: kr.width, h: kr.height },
    point0Left: point0.style.left,
    point0Rect: { x: pr.left - cr.left, y: pr.top - cr.top, w: pr.width, h: pr.height },
    point0OffsetParent: point0.offsetParent === c ? 'container' : (point0.offsetParent?.className || 'none'),
  };
})()`);
console.log(JSON.stringify(info, null, 2));
await browser.close();