import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const fr = page.frames().find((f) => f.url().includes('/canvas/'));
const info = await fr.evaluate(`(() => {
  const kicker = document.querySelector('[data-sf-id="kicker"]');
  const point0 = document.querySelector('[data-sf-id="point0"]');
  const points = document.querySelector('.sf-points');
  return {
    kickerOffsetParent: kicker.offsetParent?.className || 'none',
    point0OffsetParent: point0.offsetParent?.className || 'none',
    pointsPosition: getComputedStyle(points).position,
    pointsRect: points.getBoundingClientRect().left,
    containerRect: document.querySelector('.slide-container').getBoundingClientRect().left,
    kickerStyle: kicker.getAttribute('style'),
    point0Style: point0.getAttribute('style'),
  };
})()`);
console.log(JSON.stringify(info, null, 2));
await browser.close();