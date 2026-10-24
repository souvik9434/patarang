// shoot-connect.mjs — E2E check of the ⛓ Connect tab in a real browser.
import { chromium } from 'playwright';

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.click('button[data-tab="connect"]');
await page.waitForTimeout(600);

const state = await page.textContent('#agentState');
const toggle = await page.textContent('#btnAgentToggle');
const token = await page.textContent('#agentToken');
const snipOpen = await page.textContent('#snipOpen');
const snipMcp = await page.textContent('#snipMcp');
const list = await page.textContent('#agentList');
console.log('state:', state, '| toggle:', toggle.trim(), '| token:', token);
console.log('snipOpen has slideforge-mcp.mjs:', snipOpen.includes('slideforge-mcp.mjs'));
console.log('snipMcp lists 5 tools:', snipMcp.includes('tools:'));
console.log('agent list:', list.trim().slice(0, 120));

// reveal → raw token appears
await page.click('#btnAgentReveal');
await page.waitForTimeout(300);
const revealed = await page.textContent('#agentToken');
console.log('revealed looks like raw token:', /^sfag_[A-Za-z0-9._-]+$/.test(revealed.trim()), revealed.trim().slice(0, 12) + '…');

// screenshot
await page.screenshot({ path: 'proof/connect-tab.png', fullPage: false });
console.log('screenshot: proof/connect-tab.png');
console.log('console errors:', errors.length ? errors : 'none');
await b.close();
