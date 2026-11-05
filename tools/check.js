/* Sanity check: manifest parses, every referenced file exists, all JS files parse. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const refs = new Set([
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap((c) => c.js)
]);

// Files referenced from HTML pages.
for (const html of ['src/popup/popup.html', 'src/library/library.html', 'src/options/options.html']) {
  const src = fs.readFileSync(path.join(rootDir, html), 'utf8');
  for (const m of src.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    refs.add(path.posix.normalize(path.posix.join(path.posix.dirname(html), m[1])));
  }
}

let failed = 0;
for (const r of refs) {
  if (!fs.existsSync(path.join(rootDir, r))) {
    console.error('missing:', r);
    failed++;
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []);
}
for (const file of walk(path.join(rootDir, 'src'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    console.error('syntax error:', path.relative(rootDir, file), '\n' + e.stderr.toString());
    failed++;
  }
}

console.log(failed ? `${failed} problem(s)` : `ok — ${refs.size} referenced files present, all scripts parse`);
process.exit(failed ? 1 : 0);
