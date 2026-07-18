'use strict';
// Reader for the rekordbox collection XML export ("DJ_PLAYLISTS" format).
// Official spec: https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf
//
// We consume TRACK attributes (Name, Artist, Album, Genre, Year, TotalTime,
// Location) and TEMPO children:
//   Inizio  - beatgrid anchor position, seconds (spec permits dot OR comma decimals)
//   Bpm     - tempo at the anchor, valid until the next anchor (piecewise)
//   Metro   - meter string like "4/4" (rekordbox analysis itself only produces 4/4)
//   Battito - beat number within the bar at the anchor (1..4 for 4/4)
//
// The XML is machine-generated with double-quoted attributes, which the targeted
// regexes below rely on; this is not a general XML parser.

const path = require('path');

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAttrs(s) {
  const attrs = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[m[1]] = decodeEntities(m[2]);
  }
  return attrs;
}

/** Spec allows dot or comma decimal separators. */
function parseNum(s) {
  if (s == null || s === '') return null;
  const v = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Convert a rekordbox Location URI (file://localhost/C:/...) to a native path. */
function locationToPath(loc) {
  if (!loc) return null;
  let p = loc.replace(/^file:\/\/localhost\//i, '').replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '');
  try { p = decodeURIComponent(p); } catch { /* keep raw on malformed escapes */ }
  // Windows drive paths arrive as "C:/..."; POSIX paths need their leading slash back.
  if (!/^[a-zA-Z]:[\\/]/.test(p) && !p.startsWith('/')) p = '/' + p;
  return path.normalize(p);
}

/**
 * Parse a collection XML string.
 * @returns Array<{name, artist, album, genre, year, totalTimeSec, location, tempos:[{inizioSec,bpm,metro,battito}]}>
 */
function parseCollectionXml(xml) {
  const tracks = [];
  // TRACK elements either self-close or wrap TEMPO/POSITION_MARK children.
  const re = /<TRACK\b([^>]*?)(\/>|>([\s\S]*?)<\/TRACK>)/g;
  for (const m of xml.matchAll(re)) {
    const attrs = parseAttrs(m[1]);
    if (!attrs.Location) continue; // playlist KEY references etc.
    const body = m[3] || '';
    const tempos = [];
    for (const tm of body.matchAll(/<TEMPO\b([^>]*?)\/?>/g)) {
      const ta = parseAttrs(tm[1]);
      const inizio = parseNum(ta.Inizio);
      const bpm = parseNum(ta.Bpm);
      if (inizio == null || bpm == null || bpm <= 0) continue;
      tempos.push({
        inizioSec: inizio,
        bpm,
        metro: ta.Metro || '4/4',
        battito: parseInt(ta.Battito, 10) || 1,
      });
    }
    tempos.sort((a, b) => a.inizioSec - b.inizioSec);
    tracks.push({
      name: attrs.Name || null,
      artist: attrs.Artist || null,
      album: attrs.Album || null,
      genre: attrs.Genre || null,
      year: attrs.Year || null,
      totalTimeSec: parseNum(attrs.TotalTime),
      location: locationToPath(attrs.Location),
      tempos,
    });
  }
  return tracks;
}

/**
 * Expand piecewise TEMPO anchors into a per-beat list compatible with tempomap.js.
 * Each anchor is valid until the next; beats are generated at 60/Bpm intervals with
 * Battito giving the bar phase at the anchor. Times are float ms (XML is ms-precise
 * at best anyway).
 */
function synthesizeBeats(tempos, durationMs) {
  if (!tempos || !tempos.length) return [];
  const beats = [];
  for (let j = 0; j < tempos.length; j++) {
    const a = tempos[j];
    const startMs = a.inizioSec * 1000;
    const endMs = j + 1 < tempos.length ? tempos[j + 1].inizioSec * 1000 : durationMs;
    const stepMs = 60000 / a.bpm;
    if (!(endMs > startMs)) continue;
    let beatNum = ((a.battito - 1) % 4 + 4) % 4; // 0-based phase
    // Generate up to (but excluding) the next anchor; the next anchor supplies its
    // own first beat. Half-step guard avoids a duplicate when the region divides evenly.
    for (let t = startMs; t < endMs - stepMs / 2; t += stepMs) {
      beats.push({ beatNum: beatNum + 1, timeMs: t });
      beatNum = (beatNum + 1) % 4;
    }
  }
  // Deduplicate/sanitize: strictly increasing times.
  beats.sort((x, y) => x.timeMs - y.timeMs);
  const out = [];
  for (const b of beats) {
    if (!out.length || b.timeMs > out[out.length - 1].timeMs + 1) out.push(b);
  }
  return out;
}

module.exports = { parseCollectionXml, synthesizeBeats, locationToPath };
