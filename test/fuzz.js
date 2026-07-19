'use strict';
// Fuzz harness. Not part of `node --test` (it's slow); run manually or in CI:
//   node test/fuzz.js [iterations] [seed]
//
// Three targets:
//   1. Tempo-map pipeline: random hostile beatgrids -> buildTempoMap ->
//      writeChart -> re-parse the TEXT -> verify every beat lands within 2 ms.
//      Round-tripping through the serialized chart catches writer bugs that
//      in-memory verification cannot.
//   2. ANLZ parser: byte-level mutations of valid files must never throw
//      anything but the documented "not an ANLZ file" error, and never hang.
//   3. XML beat synthesis: hostile TEMPO anchors must yield strictly
//      increasing, bounded beat lists.

const { buildTempoMap } = require('../src/tempomap');
const { verifyTempoMap } = require('../src/verify');
const { writeChart } = require('../src/chart');
const { parseAnlz } = require('../src/anlz');
const { synthesizeBeats } = require('../src/rbxml');
const { buildAnlz, constantBeats } = require('./helpers');

const ITERATIONS = parseInt(process.argv[2], 10) || 2000;
const SEED = parseInt(process.argv[3], 10) || 0xC0FFEE;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bugs = [];
function bug(target, seedInfo, message) {
  bugs.push({ target, seedInfo, message });
  console.error(`BUG [${target}] ${seedInfo}: ${message}`);
}

// --- Target 1: tempo-map pipeline -----------------------------------------

function randomGrid(rnd) {
  const n = 2 + Math.floor(rnd() * 600);
  let t = rnd() < 0.1 ? 0 : Math.floor(rnd() * 30000);
  // Mostly plausible tempos; occasionally extreme ones to exercise clamping.
  let bpm = rnd() < 0.05 ? 5 + rnd() * 1500 : 40 + rnd() * 180;
  const wobble = rnd() * 3;
  const drift = (rnd() - 0.5) * 0.05;
  let beatNum = 1 + Math.floor(rnd() * 4);
  const beats = [];
  for (let i = 0; i < n; i++) {
    beats.push({ beatNum, timeMs: Math.round(t) });
    // Occasional grid restart: time jump + phase reset (models manual edits).
    if (rnd() < 0.005) {
      t += 1000 + rnd() * 5000;
      beatNum = 1;
    } else {
      beatNum = (beatNum % 4) + 1;
    }
    bpm = Math.min(220, Math.max(40, bpm + drift + Math.sin(i / 7) * wobble * 0.1));
    t += 60000 / bpm;
  }
  // ms rounding can collide at high BPM; enforce strict increase like rekordbox does.
  for (let i = 1; i < beats.length; i++) {
    if (beats[i].timeMs <= beats[i - 1].timeMs) beats[i].timeMs = beats[i - 1].timeMs + 1;
  }
  return beats;
}

function randomOpts(rnd) {
  const opts = {};
  if (rnd() < 0.1) opts.dense = true;
  else opts.tolMs = [0, 0.25, 1, 3][Math.floor(rnd() * 4)];
  if (rnd() < 0.2) opts.noPad = true;
  opts.padMinMs = [0, 500, 2000][Math.floor(rnd() * 3)];
  return opts;
}

const KNOWN_ERRORS = /fewer than 2 beats|strictly increasing|invalid time|--no-pad/;

/** Parse [SyncTrack] back out of chart text; also validate line-level invariants. */
function parseSyncTrack(text, seedInfo) {
  const lines = text.split('\r\n');
  const start = lines.indexOf('[SyncTrack]');
  if (start < 0) { bug('chart', seedInfo, 'missing [SyncTrack]'); return []; }
  const events = [];
  let prevLine = null;
  for (let i = start + 2; i < lines.length && lines[i].trim() !== '}'; i++) {
    const m = lines[i].trim().match(/^(\d+) = (B|TS|A) (\d+)$/);
    if (!m) { bug('chart', seedInfo, `malformed SyncTrack line: ${JSON.stringify(lines[i])}`); continue; }
    const ev = { tick: parseInt(m[1], 10), type: m[2], value: parseInt(m[3], 10) };
    if (ev.type === 'A') {
      // Anchors must directly follow a B at the same tick or Moonscraper drops them.
      if (!prevLine || prevLine.type !== 'B' || prevLine.tick !== ev.tick) {
        bug('chart', seedInfo, `orphan anchor at tick ${ev.tick}`);
      }
    } else {
      events.push(ev);
    }
    prevLine = ev;
  }
  return events;
}

function fuzzTempoMap() {
  const rnd = mulberry32(SEED);
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const beats = randomGrid(rnd);
    const opts = randomOpts(rnd);
    const seedInfo = `seed=${SEED} iter=${iter}`;
    let map;
    try {
      map = buildTempoMap(beats, opts);
    } catch (e) {
      if (!KNOWN_ERRORS.test(e.message)) bug('tempomap', seedInfo, `unexpected throw: ${e.message}`);
      continue;
    }
    const clamped = map.warnings.some((w) => w.includes('clamped'));
    const tol = opts.dense ? 0 : (opts.tolMs == null ? 1 : opts.tolMs);

    try {
      // Structural invariants.
      if (!map.events.some((e) => e.type === 'B' && e.tick === 0)) bug('tempomap', seedInfo, 'no B at tick 0');
      if (!map.events.some((e) => e.type === 'TS' && e.tick === 0)) bug('tempomap', seedInfo, 'no TS at tick 0');
      for (const e of map.events) {
        if (!Number.isInteger(e.tick) || e.tick < 0) bug('tempomap', seedInfo, `bad tick ${e.tick}`);
        if (e.type === 'B' && !Number.isInteger(e.value)) bug('tempomap', seedInfo, `non-integer B ${e.value}`);
        if (e.type === 'B' && !clamped && (e.value < 10000 || e.value > 999999)) {
          bug('tempomap', seedInfo, `B out of range without clamp warning: ${e.value}`);
        }
      }
      if (map.padMs < 0) bug('tempomap', seedInfo, `negative pad ${map.padMs}`);

      // In-memory accuracy.
      const v = verifyTempoMap(map.events, map.resolution, map.beatTicks, map.targetTimesMs);
      if (!clamped && v.maxErrMs > Math.max(2, tol + 1)) {
        bug('tempomap', seedInfo, `maxErr ${v.maxErrMs.toFixed(3)} ms (tol ${tol})`);
      }

      // Round-trip through serialized chart text.
      const text = writeChart({ name: 'fuzz' }, map.events, { resolution: map.resolution });
      const reparsed = parseSyncTrack(text, seedInfo);
      const v2 = verifyTempoMap(reparsed, map.resolution, map.beatTicks, map.targetTimesMs);
      if (!clamped && v2.maxErrMs > Math.max(2, tol + 1)) {
        bug('chart-roundtrip', seedInfo, `maxErr ${v2.maxErrMs.toFixed(3)} ms after text round-trip`);
      }
    } catch (e) {
      bug('tempomap', seedInfo, `pipeline threw after build: ${e.stack}`);
    }
  }
}

// --- Target 2: ANLZ parser mutations ---------------------------------------

function fuzzAnlz() {
  const rnd = mulberry32(SEED ^ 0x5EED);
  const base = buildAnlz({ path: '?/fuzz target.mp3', beats: constantBeats(120, 64) });
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const seedInfo = `seed=${SEED} iter=${iter}`;
    const buf = Buffer.from(base);
    const kind = Math.floor(rnd() * 4);
    if (kind === 0) {
      // truncate
      const cut = Math.floor(rnd() * buf.length);
      tryParse(buf.subarray(0, cut), seedInfo);
    } else if (kind === 1) {
      // flip random bytes
      for (let k = 0; k < 1 + rnd() * 8; k++) buf[Math.floor(rnd() * buf.length)] = Math.floor(rnd() * 256);
      tryParse(buf, seedInfo);
    } else if (kind === 2) {
      // stomp a random u32 with an extreme value (targets length fields)
      const off = Math.floor(rnd() * Math.max(1, buf.length - 4));
      buf.writeUInt32BE([0, 1, 0x7fffffff, 0xffffffff][Math.floor(rnd() * 4)], off);
      tryParse(buf, seedInfo);
    } else {
      // random garbage behind a valid magic
      const junk = Buffer.alloc(12 + Math.floor(rnd() * 200));
      for (let i = 0; i < junk.length; i++) junk[i] = Math.floor(rnd() * 256);
      junk.write('PMAI', 0, 'latin1');
      tryParse(junk, seedInfo);
    }
  }
}

function tryParse(buf, seedInfo) {
  const t0 = Date.now();
  try {
    const parsed = parseAnlz(buf);
    for (const b of parsed.beats) {
      if (!Number.isFinite(b.timeMs) || !Number.isFinite(b.tempoBpm)) {
        bug('anlz', seedInfo, 'non-finite beat fields');
        break;
      }
    }
  } catch (e) {
    if (!/ANLZ/.test(e.message)) bug('anlz', seedInfo, `unexpected throw: ${e.message}`);
  }
  if (Date.now() - t0 > 1000) bug('anlz', seedInfo, 'parse took > 1s');
}

// --- Target 3: XML beat synthesis ------------------------------------------

function fuzzXmlSynthesis() {
  const rnd = mulberry32(SEED ^ 0xA11CE);
  for (let iter = 0; iter < Math.min(ITERATIONS, 500); iter++) {
    const seedInfo = `seed=${SEED} iter=${iter}`;
    const count = Math.floor(rnd() * 20);
    const tempos = [];
    for (let i = 0; i < count; i++) {
      tempos.push({
        inizioSec: rnd() * 600 - (rnd() < 0.05 ? 50 : 0), // occasionally negative
        bpm: [0.001, 1, 60 + rnd() * 120, 5000, 1e6][Math.floor(rnd() * 5)],
        metro: '4/4',
        battito: Math.floor(rnd() * 6),
      });
    }
    tempos.sort((a, b) => a.inizioSec - b.inizioSec);
    const t0 = Date.now();
    try {
      const beats = synthesizeBeats(tempos, rnd() * 600000);
      if (beats.length > 50000) bug('rbxml', seedInfo, `beat cap exceeded: ${beats.length}`);
      for (let i = 1; i < beats.length; i++) {
        if (beats[i].timeMs <= beats[i - 1].timeMs) {
          bug('rbxml', seedInfo, `not strictly increasing at ${i}`);
          break;
        }
      }
    } catch (e) {
      bug('rbxml', seedInfo, `unexpected throw: ${e.message}`);
    }
    if (Date.now() - t0 > 2000) bug('rbxml', seedInfo, 'synthesis took > 2s');
  }
}

// ---------------------------------------------------------------------------

console.log(`fuzzing: ${ITERATIONS} iterations per target, seed ${SEED}`);
fuzzTempoMap();
fuzzAnlz();
fuzzXmlSynthesis();

if (bugs.length) {
  console.error(`\n${bugs.length} bug(s) found`);
  process.exit(1);
}
console.log('all fuzz targets clean');
