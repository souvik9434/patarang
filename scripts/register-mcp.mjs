// register-mcp.mjs — insert "slideforge" into opencode.jsonc mcp.servers (idempotent, backup first).
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const CFG = 'D:/MCP-Tools/xdg/config/opencode/opencode.jsonc';
const raw = readFileSync(CFG, 'utf8');

if (raw.includes('"slideforge"')) { console.log('already registered'); process.exit(0); }

// locate the "rea" entry inside mcp (string-match on exact source text)
const reaIdx = raw.indexOf('"rea"');
if (reaIdx === -1) { console.error('rea entry not found — abort'); process.exit(1); }

const entry = [
  '',
  '      "slideforge": {',
  '        "type": "local",',
  '        "command": [',
  '          "C:\\\\Program Files\\\\nodejs\\\\node.exe",',
  '          "D:\\\\SlideForge\\\\scripts\\\\slideforge-mcp.mjs"',
  '        ],',
  '        "disabled": false',
  '      },',
].join('\n');

// the rea entry closes with `}\n    }` (its object, then... follow realistically:
// rea block ends with `"disabled": false\n      }` then `\n    }` closing mcp.servers? we insert AFTER rea's closing brace:
// find `"rea": {` then walk to its closing `}` at same nesting by brace counting.
const openBrace = raw.indexOf('{', reaIdx);
let depth = 0, end = -1;
for (let i = openBrace; i < raw.length; i++) {
  if (raw[i] === '{') depth++;
  else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}
if (end === -1) { console.error('brace walk failed'); process.exit(1); }

const out = raw.slice(0, end + 1) + ',' + entry.slice(1).replace('\n      "slideforge"', '\n      "slideforge"').padEnd(0) + raw.slice(end + 1).replace(/^,/, (m, off) => (raw.slice(0, end + 1) + ',').length ? ',' : ',');

// Simpler: build via splice on the comma that follows rea
let after = raw.slice(end + 1);
// after should start with optional whitespace then ',' or '\n    }'
if (/^,/.test(after)) after = entry + after.slice(1).replace(/^\n\}/, '\n' + '    }');
else after = ',' + entry + after;

const next = raw.slice(0, end + 1) + after;

// sanity: strip // comments and validate JSON parses
const stripped = next.replace(/^\s*\/\/.*$/gm, '');
try { JSON.parse(stripped); } catch (e) { console.error('resulting config not valid JSON after comment strip:', e.message); process.exit(1); }

copyFileSync(CFG, CFG + '.slideforge-backup');
writeFileSync(CFG, next);
console.log('registered slideforge in opencode.jsonc (backup: opencode.jsonc.slideforge-backup)');
