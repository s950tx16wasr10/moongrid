'use strict';
// Self-verification: reconstruct each beat's audio time from the emitted SyncTrack
// exactly the way a game/editor will (piecewise tick->seconds over B events, per
// https://github.com/TheNathannator/GuitarGame_ChartFormats — Time-Conversions),
// and compare against the rekordbox beat timestamps. This is the tool's proof
// that the chart is sample-accurate before anyone plays it.

/**
 * @param {Array<{tick:number,type:string,value:number}>} events  SyncTrack events
 * @param {number} resolution ticks per quarter note
 * @param {number[]} beatTicks tick position of every source beat
 * @param {number[]} targetTimesMs expected audio time of every source beat (post-pad)
 * @returns {{maxErrMs:number, meanErrMs:number, worstBeat:number, errors:number[]}}
 */
function verifyTempoMap(events, resolution, beatTicks, targetTimesMs) {
  const bs = events
    .filter((e) => e.type === 'B')
    .sort((a, b) => a.tick - b.tick);
  if (!bs.length || bs[0].tick !== 0) throw new Error('SyncTrack must have a B event at tick 0');

  const errors = new Array(beatTicks.length);
  let maxErr = 0;
  let worst = -1;
  let sum = 0;

  let seg = 0;
  let segStartMs = 0; // chart time at bs[seg].tick
  for (let i = 0; i < beatTicks.length; i++) {
    const tick = beatTicks[i];
    while (seg + 1 < bs.length && bs[seg + 1].tick <= tick) {
      segStartMs += ((bs[seg + 1].tick - bs[seg].tick) / resolution) * (60000 / (bs[seg].value / 1000));
      seg++;
    }
    const t = segStartMs + ((tick - bs[seg].tick) / resolution) * (60000 / (bs[seg].value / 1000));
    const err = t - targetTimesMs[i];
    errors[i] = err;
    const a = Math.abs(err);
    sum += a;
    if (a > maxErr) { maxErr = a; worst = i; }
  }
  return {
    maxErrMs: maxErr,
    meanErrMs: beatTicks.length ? sum / beatTicks.length : 0,
    worstBeat: worst,
    errors,
  };
}

module.exports = { verifyTempoMap };
