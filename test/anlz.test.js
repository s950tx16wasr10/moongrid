'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAnlz, isRedactedPath, pathFilename } = require('../src/anlz');
const { buildAnlz, constantBeats } = require('./helpers');

test('parses PPTH and PQTZ from a synthetic ANLZ file', () => {
  const beats = constantBeats(120, 16);
  const buf = buildAnlz({ path: '?/My Song.mp3', beats });
  const parsed = parseAnlz(buf);
  assert.equal(parsed.path, '?/My Song.mp3');
  assert.equal(parsed.beats.length, 16);
  assert.equal(parsed.beats[0].beatNum, 1);
  assert.equal(parsed.beats[0].timeMs, 500);
  assert.ok(Math.abs(parsed.beats[0].tempoBpm - 120) < 0.01);
});

test('rejects non-ANLZ buffers', () => {
  assert.throws(() => parseAnlz(Buffer.from('not an anlz file at all')));
  assert.throws(() => parseAnlz(Buffer.alloc(4)));
});

test('tolerates truncated tag data without crashing', () => {
  const buf = buildAnlz({ beats: constantBeats(120, 8) });
  const truncated = buf.subarray(0, buf.length - 10);
  const parsed = parseAnlz(truncated);
  assert.ok(parsed.beats.length < 8); // fewer beats, no crash
});

test('redacted path detection and filename extraction', () => {
  assert.ok(isRedactedPath('?/Venus.mp3'));
  assert.ok(!isRedactedPath('/Contents/A/B/track.mp3'));
  assert.equal(pathFilename('?/Venus.mp3'), 'Venus.mp3');
  assert.equal(pathFilename('/Contents/A/B/track.mp3'), 'track.mp3');
  assert.equal(pathFilename(null), null);
});

test('unicode paths survive round-trip', () => {
  const buf = buildAnlz({ path: '?/Пример – ダンス.flac', beats: constantBeats(100, 4) });
  assert.equal(parseAnlz(buf).path, '?/Пример – ダンス.flac');
});
