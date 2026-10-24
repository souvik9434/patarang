/**
 * tests/security.test.js — locks the BYOK safety guarantees in place.
 *
 * These are the CI-enforced contract for `src/ai/config-store.js`:
 *   1. publicConfig() never contains a full API key.
 *   2. maskKey() never echoes the key head (only the last 4 chars).
 *   3. Saving a config does not leak the key into any public-shaped payload.
 * Any contributor change that breaks one of these fails the build.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FAKE_KEY = 'private-key-value-do-not-echo-9876w9yz';

// config-store reads SLIDEFORGE_DATA at import time — set it first, then import.
const dataDir = mkdtempSync(path.join(tmpdir(), 'sf-sec-'));
process.env.SLIDEFORGE_DATA = dataDir;
// biome-ignore lint/style/noProcessEnv: needed before the static import below
const { saveConfig, publicConfig, maskKey } = await import('../src/ai/config-store.js');

describe('config-store key safety', () => {
  test('saveConfig stores the key server-side only (file present, not public)', () => {
    saveConfig({ provider: 'gemini', apiKey: FAKE_KEY, model: 'gemini-2.5-pro' });
    const file = JSON.parse(readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    assert.equal(file.apiKey, FAKE_KEY); // full key lives ONLY in data/config.json
  });

  test('publicConfig() never returns the full key', () => {
    const pub = publicConfig();
    assert.equal(pub.key_present, true);
    assert.ok(!JSON.stringify(pub).includes(FAKE_KEY), 'full key leaked via publicConfig()');
    assert.equal(pub.key, `••••${FAKE_KEY.slice(-4)}`); // masked shape only
  });

  test('maskKey() never includes the key head (prefix identifies the project)', () => {
    const masked = maskKey(FAKE_KEY);
    assert.ok(masked.startsWith('••••'));
    assert.ok(!masked.includes(FAKE_KEY.slice(0, 8)), 'maskKey echoed the key head');
    assert.equal(masked.length, 8); // 4 bullets + last 4 chars
    assert.equal(maskKey(''), '');
  });

  test('a save→public round-trip leaks nothing, and clearing wipes the key', () => {
    saveConfig({ apiKey: FAKE_KEY });
    saveConfig({ apiKey: null }); // explicit clear
    assert.equal(publicConfig().key_present, false);
    // the cleared file itself must not contain the key anymore
    assert.ok(!readFileSync(path.join(dataDir, 'config.json'), 'utf8').includes(FAKE_KEY));
  });
});

describe('repo secret scanner', () => {
  // Planted sample is built from pieces so this source file itself never
  // matches the Google-key regex the scanner looks for.
  const PLANTED_GOOGLE_KEY = ['AI', 'za', 'CanRevealThisIsNever', 'ARealKey', '12345'].join('');

  const SCANNER = path.resolve(import.meta.dirname, '..', 'scripts', 'check-secrets.js');

  test('check-secrets.js passes on the clean tree and fails on a planted key', () => {
    // Clean repo: scanner must pass and print its summary line.
    const out = execFileSync(process.execPath, [SCANNER], {
      encoding: 'utf8',
      cwd: path.resolve(import.meta.dirname, '..'),
    });
    assert.match(out, /no key-shaped secrets/);

    // Planted key inside an isolated scratch dir: scanner must exit non-zero.
    const scratch = mkdtempSync(path.join(tmpdir(), 'sf-leak-'));
    try {
      writeFileSync(path.join(scratch, 'README.md'), `key = ${PLANTED_GOOGLE_KEY}\n`);
      assert.throws(
        () => execFileSync(process.execPath, [SCANNER], {
          encoding: 'utf8',
          cwd: scratch,
        }),
        /potential secret/,
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
