'use strict';
// Parser for rekordbox ANLZ analysis files (ANLZnnnn.DAT / .EXT).
// Format reference: https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/anlz.html
// All integers are big-endian. Layout:
//   file:  "PMAI" u32:lenHeader u32:lenFile, then tagged sections back to back
//   tag:   fourcc(4) u32:lenHeader u32:lenTag(total, incl. header), payload
// Tags we consume:
//   PQTZ  beat grid: header 0x18 bytes, then 8-byte entries
//         { u16 beatNumber(1-4, 1=downbeat), u16 tempo(BPM*100), u32 time(ms) }
//   PPTH  audio file path: u32 lenPath, then UTF-16BE string (NUL-terminated).
//         Local libraries (rekordbox 6/7) redact the directory to "?/filename.ext";
//         device (USB) exports carry full "/Contents/..." paths.

const FILE_MAGIC = 'PMAI';

/** Walk the tagged sections of an ANLZ buffer. Returns [{fourcc, pos, lenHeader, lenTag}]. */
function walkTags(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== FILE_MAGIC) {
    throw new Error('not an ANLZ file (missing PMAI magic)');
  }
  const fileHeaderLen = buf.readUInt32BE(4);
  const tags = [];
  let pos = fileHeaderLen;
  while (pos + 12 <= buf.length) {
    const fourcc = buf.toString('latin1', pos, pos + 4);
    const lenHeader = buf.readUInt32BE(pos + 4);
    const lenTag = buf.readUInt32BE(pos + 8);
    // A tag must at least contain its own 12-byte header and stay in bounds.
    if (lenTag < 12 || pos + lenTag > buf.length || lenHeader < 12 || lenHeader > lenTag) break;
    tags.push({ fourcc, pos, lenHeader, lenTag });
    pos += lenTag;
  }
  return tags;
}

/** Decode the PPTH path tag at `tag`. Returns a string (may be "?/name.ext" for local libraries). */
function readPath(buf, tag) {
  if (tag.lenTag < 16) return null;
  const lenPath = buf.readUInt32BE(tag.pos + 12);
  const start = tag.pos + 16;
  const end = Math.min(start + lenPath, tag.pos + tag.lenTag, buf.length);
  if (end <= start) return null;
  let raw = Buffer.from(buf.subarray(start, end));
  if (raw.length % 2) raw = raw.subarray(0, raw.length - 1); // swap16 requires even length
  raw.swap16(); // UTF-16BE -> UTF-16LE
  return raw.toString('utf16le').replace(/\0+$/, '');
}

/** Decode the PQTZ beat grid at `tag`. Returns [{beatNum, tempoBpm, timeMs}]. */
function readBeatGrid(buf, tag) {
  if (tag.lenHeader < 24) return [];
  const numBeats = buf.readUInt32BE(tag.pos + 20);
  const entriesStart = tag.pos + tag.lenHeader;
  const maxByLen = Math.floor((tag.pos + tag.lenTag - entriesStart) / 8);
  const maxByBuf = Math.floor((buf.length - entriesStart) / 8);
  const n = Math.min(numBeats, maxByLen, maxByBuf);
  const beats = new Array(Math.max(0, n));
  for (let i = 0; i < n; i++) {
    const off = entriesStart + i * 8;
    beats[i] = {
      beatNum: buf.readUInt16BE(off),
      tempoBpm: buf.readUInt16BE(off + 2) / 100,
      timeMs: buf.readUInt32BE(off + 4),
    };
  }
  return beats;
}

/**
 * Parse an ANLZ buffer.
 * @returns {{ path: string|null, beats: Array<{beatNum:number,tempoBpm:number,timeMs:number}>, tags: string[] }}
 */
function parseAnlz(buf) {
  const tags = walkTags(buf);
  let path = null;
  let beats = [];
  for (const t of tags) {
    if (t.fourcc === 'PPTH' && path === null) path = readPath(buf, t);
    if (t.fourcc === 'PQTZ' && beats.length === 0) beats = readBeatGrid(buf, t);
  }
  return { path, beats, tags: tags.map((t) => t.fourcc) };
}

/** True if a PPTH path is the redacted local-library form ("?/filename.ext"). */
function isRedactedPath(p) {
  return typeof p === 'string' && p.startsWith('?/');
}

/** Filename portion of a PPTH path (works for redacted, /Contents/..., and full paths). */
function pathFilename(p) {
  if (!p) return null;
  const parts = p.split('/');
  return parts[parts.length - 1] || null;
}

module.exports = { parseAnlz, walkTags, isRedactedPath, pathFilename };
