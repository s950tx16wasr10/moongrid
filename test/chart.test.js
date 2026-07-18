'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { writeChart } = require('../src/chart');
const { writeSongIni } = require('../src/songini');

const META = { name: 'Venus', artist: 'Television', album: 'Marquee Moon', genre: 'Rock', year: '1977' };
const EVENTS = [
  { tick: 0, type: 'TS', value: 4 },
  { tick: 0, type: 'B', value: 113620 },
  { tick: 768, type: 'B', value: 113208, anchorUs: 4227000 },
];

test('chart structure: sections, tick-0 events, B-before-A pairing', () => {
  const text = writeChart(META, EVENTS);
  assert.match(text, /\[Song\]/);
  assert.match(text, /\[SyncTrack\]/);
  assert.match(text, /\[Events\]/);
  assert.match(text, /Resolution = 192/);
  assert.match(text, /Offset = 0/);
  assert.match(text, /MusicStream = "song\.ogg"/);

  const lines = text.split('\r\n').map((l) => l.trim());
  const sync = lines.slice(lines.indexOf('[SyncTrack]') + 2, lines.indexOf('}', lines.indexOf('[SyncTrack]')));
  assert.equal(sync[0], '0 = TS 4');
  assert.equal(sync[1], '0 = B 113620');
  assert.equal(sync[2], '768 = B 113208');
  assert.equal(sync[3], '768 = A 4227000'); // anchor directly after its B
});

test('anchors can be disabled', () => {
  const text = writeChart(META, EVENTS, { anchors: false });
  assert.ok(!/= A /.test(text));
});

test('metadata is escaped (double quotes cannot break the value)', () => {
  const text = writeChart({ ...META, name: 'My "Song"' }, EVENTS);
  assert.match(text, /Name = "My 'Song'"/);
});

test('song.ini has the essentials and delay 0', () => {
  const ini = writeSongIni({ ...META, songLengthMs: 231079 });
  assert.match(ini, /\[song\]/);
  assert.match(ini, /name = Venus/);
  assert.match(ini, /artist = Television/);
  assert.match(ini, /delay = 0/);
  assert.match(ini, /song_length = 231079/);
});
