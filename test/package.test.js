'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { packageSong } = require('../src/package');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moongrid-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('refuses to overwrite an existing notes.chart without force', (t) => {
  const outDir = path.join(tmpDir(t), 'song');
  const base = { outDir, chartText: 'v1', iniText: 'ini', chartOnly: true };
  packageSong(base);
  fs.writeFileSync(path.join(outDir, 'notes.chart'), 'charted notes here');
  assert.throws(() => packageSong({ ...base, chartText: 'v2' }), /--force/);
  assert.equal(fs.readFileSync(path.join(outDir, 'notes.chart'), 'utf8'), 'charted notes here');
});

test('force overwrites notes.chart', (t) => {
  const outDir = path.join(tmpDir(t), 'song');
  const base = { outDir, chartText: 'v1', iniText: 'ini', chartOnly: true };
  packageSong(base);
  packageSong({ ...base, chartText: 'v2', force: true });
  assert.equal(fs.readFileSync(path.join(outDir, 'notes.chart'), 'utf8'), 'v2');
});

test('chart-only with pad emits a warning about missing silence', (t) => {
  const outDir = path.join(tmpDir(t), 'song');
  const r = packageSong({ outDir, chartText: 'c', iniText: 'i', chartOnly: true, padMs: 1805 });
  assert.ok(r.warnings.some((w) => w.includes('1805')));
});
