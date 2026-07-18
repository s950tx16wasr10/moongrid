'use strict';
// Converts a per-beat timestamp list (from a rekordbox beat grid) into a .chart
// [SyncTrack] tempo map that reproduces every beat time to sub-millisecond accuracy.
//
// Design notes (why, not what):
//
// * BPMs are derived from successive beat TIMESTAMPS, never from rekordbox's stored
//   tempo field: timestamps are millisecond-exact, the tempo field is a 0.01-BPM
//   quantized estimate that rekordbox refreshes only every few beats.
//
// * .chart stores tempo as integer milli-BPM. Rounding each segment independently
//   would accumulate error over hundreds of beats, so emission is closed-loop:
//   each segment's milli-BPM is chosen to land the NEXT boundary on its true time
//   given everything already emitted. Residual per boundary is < ~0.3 ms and does
//   not accumulate.
//
// * rekordbox timestamps are integer milliseconds, so per-beat derived BPM jitters
//   even when the true tempo is constant. Segmentation collapses runs of beats
//   that fit a constant tempo within `tolMs` into a single BPM event: a static
//   grid becomes one event, a dynamic grid stays as dense as it needs to be.
//
// * The chart must start at tick 0 == audio time 0 with Offset 0 (Clone Hero
//   convention; the Offset/delay fields are discouraged and hash-unfriendly).
//   The gap before the first beat becomes a whole number of lead-in measures at
//   the song's starting tempo; the audio is padded with silence so the first
//   downbeat lands exactly on a measure boundary. `noPad` mode instead stretches
//   a lead-in tempo over the original gap (refusing when that tempo would be
//   absurd) so the audio can stay untouched.

const TICKS_PER_BEAT_DEFAULT = 192;
const BEATS_PER_BAR = 4; // rekordbox grids are strictly 4/4 (beatNum cycles 1-4)

/**
 * @param {Array<{beatNum:number, timeMs:number}>} beats  strictly increasing times
 * @param {object} [opts]
 * @param {number}  [opts.resolution=192]  ticks per quarter note
 * @param {number}  [opts.padMinMs=2000]   minimum silence before the first beat (pad mode)
 * @param {number}  [opts.tolMs=1.0]       segmentation tolerance; 0 or `dense` = event per beat
 * @param {boolean} [opts.dense=false]     emit one BPM event per beat (no segmentation)
 * @param {boolean} [opts.noPad=false]     do not pad audio; fit a lead-in tempo to the gap
 * @param {number}  [opts.maxBpm=999.999]  Moonscraper's UI ceiling
 * @param {number}  [opts.minBpm=10]
 * @returns {{
 *   events: Array<{tick:number, type:'B'|'TS', value:number, anchorUs?:number}>,
 *   padMs: number, leadTicks: number, resolution: number,
 *   beatTicks: number[], targetTimesMs: number[],
 *   stats: object, warnings: string[]
 * }}
 */
function buildTempoMap(beats, opts = {}) {
  const resolution = opts.resolution || TICKS_PER_BEAT_DEFAULT;
  const padMinMs = opts.padMinMs == null ? 2000 : opts.padMinMs;
  const tolMs = opts.tolMs == null ? 1.0 : opts.tolMs;
  const dense = !!opts.dense;
  const noPad = !!opts.noPad;
  const maxBpm = opts.maxBpm || 999.999;
  const minBpm = opts.minBpm || 10;
  const warnings = [];

  validateBeats(beats);

  const n = beats.length;
  const t0 = beats[0].timeMs;
  const barTicks = resolution * BEATS_PER_BAR;

  // --- Lead-in geometry ---------------------------------------------------
  // First beat may be a pickup (beatNum != 1). Place it at k full measures plus
  // its phase within the bar, so the first downbeat still lands on a barline.
  const phase0 = normalizePhase(beats[0].beatNum);
  // Starting tempo, averaged over up to 8 intervals to smooth ms quantization.
  const span = Math.min(8, n - 1);
  const bpmStart = (60000 * span) / (beats[span].timeMs - t0);

  let leadTicks, padMs, leadMilliBpm;
  if (noPad) {
    // Audio untouched: lead-in tempo must cover exactly t0.
    const k = 1;
    leadTicks = k * barTicks + phase0 * resolution;
    const leadBeats = leadTicks / resolution;
    const exact = (60000 * leadBeats) / t0;
    if (exact > maxBpm) {
      throw new Error(
        `intro is too short (${t0} ms) for --no-pad: lead-in would need ${exact.toFixed(1)} BPM ` +
        `(max ${maxBpm}). Re-run without --no-pad to pad the audio with silence instead.`
      );
    }
    let kk = k;
    let bpm = exact;
    while (bpm < minBpm) { kk++; bpm = (60000 * (kk * BEATS_PER_BAR + phase0)) / t0; }
    leadTicks = kk * barTicks + phase0 * resolution;
    leadMilliBpm = Math.round(bpm * 1000);
    padMs = 0;
  } else {
    // Pad mode: lead-in plays at the song's own starting tempo; silence makes it exact.
    const beatDur = 60000 / bpmStart;
    let k = 1;
    while ((k * BEATS_PER_BAR + phase0) * beatDur < Math.max(t0, padMinMs)) k++;
    leadTicks = k * barTicks + phase0 * resolution;
    const leadBeats = leadTicks / resolution;
    // Integer-ms pad (ffmpeg adelay granularity), then fit the emitted lead tempo to it.
    padMs = Math.round(leadBeats * beatDur - t0);
    if (padMs < 0) padMs = 0;
    const exact = (60000 * leadBeats) / (t0 + padMs);
    leadMilliBpm = Math.round(exact * 1000);
  }
  clampCheck(leadMilliBpm, minBpm, maxBpm, 'lead-in', warnings);

  // --- Target times & tick assignment --------------------------------------
  const target = beats.map((b) => b.timeMs + padMs); // audio times after padding
  const beatTicks = beats.map((_, i) => leadTicks + i * resolution);

  // --- Bar-phase discontinuities -> TS re-anchor + forced segment boundary ---
  // rekordbox grids occasionally restart the 1-4 cycle mid-bar (manual grid edits).
  // A TS 4 event at the offending downbeat restarts barlines there.
  const forcedBoundaries = new Set();
  const tsEvents = [{ tick: 0, type: 'TS', value: BEATS_PER_BAR }];
  let lastTsTick = 0;
  let discontinuities = 0;
  for (let i = 0; i < n; i++) {
    if (normalizePhase(beats[i].beatNum) !== ((beatTicks[i] - lastTsTick) / resolution) % BEATS_PER_BAR) {
      if (beats[i].beatNum === 1) {
        tsEvents.push({ tick: beatTicks[i], type: 'TS', value: BEATS_PER_BAR });
        lastTsTick = beatTicks[i];
        forcedBoundaries.add(i);
        discontinuities++;
      }
      // Non-downbeat phase mismatches resolve themselves at the next downbeat.
    }
  }
  if (discontinuities > 0) {
    warnings.push(
      `${discontinuities} bar-phase discontinuit${discontinuities === 1 ? 'y' : 'ies'} in the ` +
      'rekordbox grid; inserted TS events to keep barlines aligned'
    );
  }

  // --- Segmentation ---------------------------------------------------------
  const boundaries = dense || tolMs <= 0
    ? allBoundaries(n)
    : segment(target, tolMs, forcedBoundaries);

  // --- Closed-loop emission -------------------------------------------------
  const bEvents = [];
  // Chart time implied by the emitted lead-in tempo (differs from target[0] by <0.5ms).
  let chartTime = (leadTicks / resolution) * (60000 / (leadMilliBpm / 1000));
  bEvents.push({ tick: 0, type: 'B', value: leadMilliBpm });

  for (let b = 0; b + 1 < boundaries.length; b++) {
    const s = boundaries[b];
    const e = boundaries[b + 1];
    // No event at the final beat: the last segment's tempo simply carries on.
    const segBeats = e - s;
    const exactBpm = (60000 * segBeats) / (target[e] - chartTime);
    const milli = clampMilli(exactBpm, minBpm, maxBpm, warnings);
    pushB(bEvents, beatTicks[s], milli, target[s]);
    chartTime += segBeats * (60000 / (milli / 1000));
  }

  // Coalesce consecutive B events with identical values (timing-neutral by
  // definition). The first beat's event is exempt: its anchor keeps the song
  // locked to the audio if anyone later edits the lead-in tempo in Moonscraper.
  const coalesced = [];
  for (const ev of bEvents) {
    const prev = coalesced[coalesced.length - 1];
    if (prev && prev.value === ev.value && ev.tick !== leadTicks) continue;
    coalesced.push(ev);
  }

  const events = [...tsEvents, ...coalesced].sort(
    (a, b2) => a.tick - b2.tick || (a.type === 'TS' ? -1 : 1) // TS before B at same tick
  );

  const emittedBpms = coalesced.map((e) => e.value / 1000);
  return {
    events,
    padMs,
    leadTicks,
    resolution,
    beatTicks,
    targetTimesMs: target,
    warnings,
    stats: {
      beats: n,
      bpmEvents: coalesced.length,
      tsEvents: tsEvents.length,
      leadBpm: leadMilliBpm / 1000,
      minBpm: Math.min(...emittedBpms),
      maxBpm: Math.max(...emittedBpms),
      padMs,
      discontinuities,
    },
  };
}

function validateBeats(beats) {
  if (!Array.isArray(beats) || beats.length < 2) {
    throw new Error('beat grid has fewer than 2 beats — nothing to convert');
  }
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (!Number.isFinite(b.timeMs) || b.timeMs < 0) throw new Error(`beat ${i} has invalid time ${b.timeMs}`);
    if (i > 0 && b.timeMs <= beats[i - 1].timeMs) {
      throw new Error(`beat times not strictly increasing at index ${i} (${beats[i - 1].timeMs} -> ${b.timeMs})`);
    }
  }
}

function normalizePhase(beatNum) {
  // beatNum is 1-4 in valid grids; anything else counts as "unknown", treated as downbeat.
  const p = (Number(beatNum) || 1) - 1;
  return ((p % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
}

function allBoundaries(n) {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * Greedy polyline simplification over (index, time): extend a segment while every
 * interior beat lies within tolMs of the straight line between its endpoints.
 * Returns boundary indices (segment starts; last entry is the final beat index).
 */
function segment(times, tolMs, forced) {
  const n = times.length;
  const boundaries = [0];
  let s = 0;
  while (s < n - 1) {
    let e = s + 1;
    // Extend while the next beat still fits the segment's straight line and the
    // current end isn't a forced cut point.
    while (e < n - 1 && !forced.has(e) && fits(times, s, e + 1, tolMs)) e++;
    boundaries.push(e);
    s = e;
  }
  return boundaries;
}

function fits(times, s, e, tolMs) {
  const slope = (times[e] - times[s]) / (e - s);
  for (let m = s + 1; m < e; m++) {
    if (Math.abs(times[s] + (m - s) * slope - times[m]) > tolMs) return false;
  }
  return true;
}

function clampMilli(bpm, minBpm, maxBpm, warnings) {
  let milli = Math.round(bpm * 1000);
  if (milli > maxBpm * 1000) { warnings.push(`clamped ${bpm.toFixed(3)} BPM to ${maxBpm}`); milli = Math.round(maxBpm * 1000); }
  if (milli < minBpm * 1000) { warnings.push(`clamped ${bpm.toFixed(3)} BPM to ${minBpm}`); milli = Math.round(minBpm * 1000); }
  return milli;
}

function clampCheck(milli, minBpm, maxBpm, label, warnings) {
  const bpm = milli / 1000;
  if (bpm > maxBpm || bpm < minBpm) {
    warnings.push(`${label} tempo ${bpm.toFixed(3)} BPM is outside [${minBpm}, ${maxBpm}]`);
  }
}

function pushB(events, tick, milliBpm, audioTimeMs) {
  events.push({ tick, type: 'B', value: milliBpm, anchorUs: Math.round(audioTimeMs * 1000) });
}

module.exports = { buildTempoMap };
