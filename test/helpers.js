'use strict';
// Test helpers: build synthetic ANLZ buffers and beat lists.

function u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; }
function u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); return b; }

/** Build a minimal valid ANLZ file with PPTH + PQTZ tags. */
function buildAnlz({ path: p = '?/test.mp3', beats = [] } = {}) {
  // PPTH: header 16 bytes (fourcc, lenHeader, lenTag, lenPath) + UTF-16BE path + NUL
  const pathBuf = Buffer.from(p + '\0', 'utf16le');
  pathBuf.swap16();
  const ppth = Buffer.concat([
    Buffer.from('PPTH', 'latin1'), u32(16), u32(16 + pathBuf.length), u32(pathBuf.length), pathBuf,
  ]);

  // PQTZ: header 24 bytes (fourcc, lenHeader, lenTag, unk1, unk2, numBeats) + entries
  const entries = Buffer.concat(beats.map((b) =>
    Buffer.concat([u16(b.beatNum), u16(Math.round((b.tempoBpm || 120) * 100)), u32(Math.round(b.timeMs))])
  ));
  const pqtz = Buffer.concat([
    Buffer.from('PQTZ', 'latin1'), u32(24), u32(24 + entries.length),
    u32(0), u32(0x00080000), u32(beats.length), entries,
  ]);

  const body = Buffer.concat([ppth, pqtz]);
  const header = Buffer.concat([Buffer.from('PMAI', 'latin1'), u32(28), u32(28 + body.length), Buffer.alloc(16)]);
  return Buffer.concat([header, body]);
}

/** Constant-BPM beat list with integer-ms rounding, like rekordbox writes. */
function constantBeats(bpm, count, startMs = 500, startBeatNum = 1) {
  const step = 60000 / bpm;
  const beats = [];
  for (let i = 0; i < count; i++) {
    beats.push({ beatNum: ((startBeatNum - 1 + i) % 4) + 1, timeMs: Math.round(startMs + i * step) });
  }
  return beats;
}

/** Linear tempo ramp from bpmA to bpmB across `count` beats, ms-rounded. */
function rampBeats(bpmA, bpmB, count, startMs = 500) {
  const beats = [];
  let t = startMs;
  for (let i = 0; i < count; i++) {
    beats.push({ beatNum: (i % 4) + 1, timeMs: Math.round(t) });
    const bpm = bpmA + ((bpmB - bpmA) * i) / (count - 1);
    t += 60000 / bpm;
  }
  return beats;
}

module.exports = { buildAnlz, constantBeats, rampBeats };
