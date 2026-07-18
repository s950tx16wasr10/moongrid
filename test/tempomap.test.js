'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildTempoMap } = require('../src/tempomap');
const { verifyTempoMap } = require('../src/verify');
const { constantBeats, rampBeats } = require('./helpers');

function check(beats, opts = {}) {
  const map = buildTempoMap(beats, opts);
  const v = verifyTempoMap(map.events, map.resolution, map.beatTicks, map.targetTimesMs);
  return { map, v };
}

test('constant 120 BPM collapses to few events with sub-ms accuracy', () => {
  const { map, v } = check(constantBeats(120, 200));
  assert.ok(v.maxErrMs < 1, `max error ${v.maxErrMs}`);
  assert.ok(map.stats.bpmEvents <= 4, `expected few BPM events, got ${map.stats.bpmEvents}`);
  // First beat lands on a measure boundary (768-tick multiple)
  assert.equal(map.beatTicks[0] % 768, 0);
});

test('every emitted BPM stays within Moonscraper bounds', () => {
  const { map } = check(rampBeats(60, 400, 300));
  for (const e of map.events.filter((x) => x.type === 'B')) {
    assert.ok(e.value >= 10000 && e.value <= 999999, `BPM out of range: ${e.value}`);
  }
});

test('tempo ramp tracks within tolerance', () => {
  const { v } = check(rampBeats(100, 140, 240));
  assert.ok(v.maxErrMs < 1.5, `max error ${v.maxErrMs}`);
});

test('rekordbox-style wobble (ms-rounded, tempo drifts every 4 beats)', () => {
  // Emulates dynamic analysis: BPM re-estimated every 4 beats, times ms-rounded.
  const beats = [];
  let t = 195;
  let bpm = 113.6;
  for (let i = 0; i < 440; i++) {
    beats.push({ beatNum: (i % 4) + 1, timeMs: Math.round(t) });
    if (i % 4 === 3) bpm += (Math.sin(i / 10) * 0.9);
    t += 60000 / bpm;
  }
  const { map, v } = check(beats);
  assert.ok(v.maxErrMs < 1.5, `max error ${v.maxErrMs}`);
  assert.ok(map.stats.bpmEvents < 440, 'segmentation should compress events');
});

test('dense mode emits (nearly) one BPM event per beat and stays exact', () => {
  const beats = rampBeats(100, 160, 120);
  const { map, v } = check(beats, { dense: true });
  assert.ok(v.maxErrMs < 1, `max error ${v.maxErrMs}`);
  // Coalescing may merge identical neighbors, so allow some slack below n-1.
  assert.ok(map.stats.bpmEvents > 60, `dense should emit many events, got ${map.stats.bpmEvents}`);
});

test('pickup start (first beat is beat 3) keeps downbeats on barlines', () => {
  const beats = constantBeats(120, 100, 500, 3);
  const { map, v } = check(beats);
  assert.ok(v.maxErrMs < 1);
  // First beat is phase 2 (0-based), so its tick is barline + 2*192.
  assert.equal(map.beatTicks[0] % 768, 384);
  // The first downbeat (index 2) must land on a barline.
  assert.equal(map.beatTicks[2] % 768, 0);
});

test('lead-in: audio pad produces >= padMin of silence and exact first-beat time', () => {
  const beats = constantBeats(128, 50, 195); // 195 ms intro, like Venus
  const { map } = check(beats, { padMinMs: 2000 });
  assert.ok(map.padMs >= 2000 - 195, `pad ${map.padMs}`);
  assert.equal(map.targetTimesMs[0], 195 + map.padMs);
  // Tick-0 B event exists
  assert.ok(map.events.some((e) => e.type === 'B' && e.tick === 0));
  assert.ok(map.events.some((e) => e.type === 'TS' && e.tick === 0));
});

test('no-pad mode with a reasonable intro fits a lead-in tempo', () => {
  const beats = constantBeats(120, 50, 1900);
  const { map, v } = check(beats, { noPad: true });
  assert.equal(map.padMs, 0);
  assert.ok(v.maxErrMs < 1);
});

test('no-pad mode refuses an impossible short intro', () => {
  const beats = constantBeats(120, 50, 100); // 100 ms — would need >999 BPM lead-in
  assert.throws(() => buildTempoMap(beats, { noPad: true }), /no-pad/);
});

test('bar-phase discontinuity inserts a TS re-anchor', () => {
  // 32 clean beats, then the grid restarts mid-bar (beatNum jumps back to 1 early).
  const a = constantBeats(120, 30, 500);
  const bStart = a[a.length - 1].timeMs + 500;
  const b = constantBeats(120, 30, bStart, 1);
  // a ends on beatNum 30%4 -> the 30th beat has beatNum ((30-1)%4)+1 = 2, so a fresh
  // downbeat right after is a discontinuity.
  const beats = [...a, ...b];
  const { map, v } = check(beats);
  const tsEvents = map.events.filter((e) => e.type === 'TS');
  assert.ok(tsEvents.length >= 2, `expected re-anchor TS, got ${tsEvents.length}`);
  assert.ok(v.maxErrMs < 1.5, `max error ${v.maxErrMs}`);
});

test('rejects garbage grids', () => {
  assert.throws(() => buildTempoMap([]));
  assert.throws(() => buildTempoMap([{ beatNum: 1, timeMs: 100 }]));
  assert.throws(() => buildTempoMap([
    { beatNum: 1, timeMs: 100 },
    { beatNum: 2, timeMs: 100 }, // not strictly increasing
  ]));
});

test('anchors carry true audio time in microseconds', () => {
  const beats = constantBeats(120, 20, 500);
  const { map } = check(beats);
  const firstBeatB = map.events.find((e) => e.type === 'B' && e.tick === map.beatTicks[0]);
  assert.ok(firstBeatB, 'expected a B event at the first beat');
  assert.equal(firstBeatB.anchorUs, (500 + map.padMs) * 1000);
});
