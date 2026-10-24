import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, hasScriptish } from '../src/sanitize.js';

const XSS_CORPUS = [
  '<script>alert(1)</script>',
  '<img src=x onerror="alert(1)">',
  '<a href="javascript:alert(1)">click</a>',
  '<div style="background-image:url(javascript:alert(1))">x</div>',
  '<iframe src="https://evil.example"></iframe>',
  '<svg><script>alert(1)</script></svg>',
  '<body onload="alert(1)">hi</body>',
  '<div style="behavior:url(#default#time2)">x</div>',
  '<object data="evil.swf"></object>',
  '<style>@import "https://evil.example/x.css";</style>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
];

test('sanitiser removes every script-ish construct', () => {
  for (const payload of XSS_CORPUS) {
    const out = sanitize(payload);
    assert.equal(hasScriptish(out), false, `payload leaked: ${payload}\n=> ${out}`);
    assert.equal(/javascript:/i.test(out), false, `js url leaked: ${payload}\n=> ${out}`);
  }
});

test('sanitiser keeps benign structure and text', () => {
  const out = sanitize('<div class="a"><h1>Hello</h1><p>World <strong>bold</strong></p></div>');
  assert.ok(out.includes('<h1>Hello</h1>'));
  assert.ok(out.includes('<strong>bold</strong>'));
  assert.ok(out.includes('class="a"'));
});

test('sanitiser strips event handlers but keeps data attributes', () => {
  const out = sanitize('<div data-sf-id="title" onclick="x()" class="t">A</div>');
  assert.ok(out.includes('data-sf-id="title"'));
  assert.equal(/onclick/i.test(out), false);
});

test('sanitiser drops script content entirely', () => {
  const out = sanitize('<div>a</div><script>var secret=1</script><div>b</div>');
  assert.equal(out.includes('secret'), false);
});

test('sanitiser keeps inline style but filters unsafe properties', () => {
  const out = sanitize('<div style="color:red;position:absolute;behavior:url(x)">y</div>');
  assert.ok(out.includes('color:red'));
  assert.ok(out.includes('position:absolute'));
  assert.equal(/behavior/i.test(out), false);
});

test('sanitiser keeps data:image urls but blocks data:text/html', () => {
  const ok = sanitize('<img src="data:image/png;base64,AAA" alt="x">');
  assert.ok(ok.includes('data:image/png'));
  const bad = sanitize('<img src="data:text/html,<script>alert(1)</script>" alt="x">');
  assert.equal(/data:text\/html/.test(bad), false);
});
