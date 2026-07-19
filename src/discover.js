'use strict';
// Track discovery. Merges three independent sources, all optional, so the tool
// degrades gracefully on machines where any of them is missing:
//
//   1. networkAnalyze6.db (plain SQLite, written by rekordbox 6/7 during analysis):
//      manage_tbl maps full audio path -> full ANLZ path. Best source, but only
//      covers tracks analyzed since the feature appeared, and reading it needs
//      node:sqlite (Node >= 22.5).
//   2. Scanning the USBANLZ tree for ANLZ0000.DAT files: always works, yields the
//      beatgrid plus the PPTH path. Local libraries redact PPTH to "?/filename",
//      device (USB) exports carry resolvable "/Contents/..." paths.
//   3. A rekordbox collection XML export (--xml): portable metadata source
//      (title/artist/album, audio Location, duration), matched to ANLZ tracks
//      by audio filename.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseAnlz, isRedactedPath, pathFilename } = require('./anlz');

/** Candidate rekordbox app-data dirs per platform (existing ones only). */
function defaultRekordboxDirs() {
  const dirs = [];
  const names = ['rekordbox', 'rekordbox6', 'rekordbox7'];
  if (process.platform === 'win32' && process.env.APPDATA) {
    for (const n of names) dirs.push(path.join(process.env.APPDATA, 'Pioneer', n));
  } else if (process.platform === 'darwin') {
    for (const n of names) dirs.push(path.join(os.homedir(), 'Library', 'Pioneer', n));
  }
  return dirs.filter((d) => {
    try { return fs.statSync(d).isDirectory(); } catch { return false; }
  });
}

function defaultAnlzRoots() {
  return defaultRekordboxDirs()
    .map((d) => path.join(d, 'share', 'PIONEER', 'USBANLZ'))
    .filter((d) => {
      try { return fs.statSync(d).isDirectory(); } catch { return false; }
    });
}

function defaultManageDbs() {
  return defaultRekordboxDirs()
    .map((d) => path.join(d, 'networkAnalyze6.db'))
    .filter((f) => {
      try { return fs.statSync(f).isFile(); } catch { return false; }
    });
}

/**
 * Read manage_tbl from networkAnalyze6.db. Returns [{audioPath, anlzDat, durationMs}]
 * or null when unavailable (missing node:sqlite, unreadable file, schema change...).
 */
function readManageTbl(dbPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return null; // Node < 22.5: source unavailable, callers fall back to scanning
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare('SELECT SongFilePath, AnalyzeFilePath, Duration FROM manage_tbl')
      .all();
    return rows
      .filter((r) => r.SongFilePath && r.AnalyzeFilePath)
      .map((r) => ({
        audioPath: path.normalize(String(r.SongFilePath)),
        anlzDat: path.normalize(String(r.AnalyzeFilePath)),
        durationMs: Number(r.Duration) || null,
      }));
  } catch {
    return null;
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

/** Recursively find ANLZ*.DAT files under a root (bounded depth guards odd layouts). */
function scanAnlzRoot(root, maxDepth = 6) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/^ANLZ\d+\.DAT$/i.test(e.name)) found.push(full);
    }
  };
  walk(root, 0);
  return found;
}

/**
 * For a device (USB) export, PPTH holds "/Contents/Artist/Album/track.mp3" and the
 * USBANLZ root sits at <drive>/PIONEER/USBANLZ — so the audio resolves against the
 * grandparent of the USBANLZ root.
 */
function resolveDevicePath(anlzDat, ppth) {
  if (!ppth || !ppth.startsWith('/')) return null;
  const m = anlzDat.replace(/\\/g, '/').match(/^(.*)\/PIONEER\/USBANLZ\//i);
  if (!m) return null;
  const candidate = path.join(m[1], ppth);
  try { return fs.statSync(candidate).isFile() ? candidate : null; } catch { return null; }
}

/**
 * Discover tracks with beatgrids.
 * @param {object} opts
 * @param {string[]} [opts.anlzDirs]  extra USBANLZ roots (e.g. "E:\\PIONEER\\USBANLZ")
 * @param {string[]} [opts.manageDbs] extra networkAnalyze6.db paths to read
 * @param {object[]} [opts.xmlTracks] parsed rekordbox XML tracks (see rbxml.js)
 * @returns {{tracks: object[], warnings: string[]}}
 */
function discoverTracks(opts = {}) {
  const warnings = [];
  const roots = [...new Set([...(opts.anlzDirs || []), ...defaultAnlzRoots()])];
  const byAnlz = new Map(); // normalized ANLZ .DAT path -> track

  const keyOf = (p) => path.normalize(p).toLowerCase();

  // Source 2: scan the ANLZ trees (defines the universe of known beatgrids).
  for (const root of roots) {
    for (const dat of scanAnlzRoot(root)) {
      const key = keyOf(dat);
      if (byAnlz.has(key)) continue;
      let parsed;
      try {
        parsed = parseAnlz(fs.readFileSync(dat));
      } catch (e) {
        warnings.push(`skipping unreadable ANLZ file ${dat}: ${e.message}`);
        continue;
      }
      if (!parsed.beats.length) continue; // no beatgrid, nothing to convert
      const track = {
        anlzDat: dat,
        beats: parsed.beats,
        ppth: parsed.path,
        filename: pathFilename(parsed.path),
        audioPath: null,
        durationMs: null,
        meta: {},
        sources: ['anlz'],
      };
      if (parsed.path && !isRedactedPath(parsed.path)) {
        track.audioPath = resolveDevicePath(dat, parsed.path);
        if (!track.audioPath) {
          // rekordbox 5-era local analyses store absolute paths, on Windows in the
          // form "/C:/Users/..." — strip the leading slash before the drive letter.
          const m = parsed.path.match(/^\/([A-Za-z]:\/.*)$/);
          const candidate = m ? m[1] : parsed.path;
          if (path.isAbsolute(candidate)) {
            try { if (fs.statSync(candidate).isFile()) track.audioPath = path.normalize(candidate); } catch { /* stale */ }
          }
        }
      }
      byAnlz.set(key, track);
    }
  }

  // Source 1: manage_tbl gives authoritative audio paths for its rows.
  const manageDbs = [...new Set([...(opts.manageDbs || []), ...defaultManageDbs()])];
  let manageAvailable = false;
  for (const dbPath of manageDbs) {
    const rows = readManageTbl(dbPath);
    if (!rows) continue;
    manageAvailable = true;
    for (const row of rows) {
      const track = byAnlz.get(keyOf(row.anlzDat));
      if (!track) continue; // analysis deleted or under an unscanned root
      track.durationMs = track.durationMs || row.durationMs;
      if (!track.sources.includes('manage_tbl')) track.sources.push('manage_tbl');
      let exists = false;
      try { exists = fs.statSync(row.audioPath).isFile(); } catch { /* moved/deleted */ }
      if (exists) track.audioPath = row.audioPath;
      else warnings.push(`audio file from rekordbox no longer exists: ${row.audioPath}`);
    }
  }
  if (manageDbs.length && !manageAvailable) {
    let hasSqlite = true;
    try { require('node:sqlite'); } catch { hasSqlite = false; }
    warnings.push(hasSqlite
      ? `could not read rekordbox analysis registry (${manageDbs.join(', ')}) — locked or ` +
        'schema changed; audio paths must come from --xml or --audio'
      : 'node:sqlite unavailable (Node >= 22.5 required) — cannot read rekordbox analysis DB; ' +
        'audio paths must come from --xml or --audio'
    );
  }

  // Source 3: XML metadata, matched by audio filename (and duration when known).
  if (opts.xmlTracks && opts.xmlTracks.length) {
    const byFilename = new Map();
    for (const x of opts.xmlTracks) {
      const fn = x.location ? path.basename(x.location).toLowerCase() : null;
      if (!fn) continue;
      if (!byFilename.has(fn)) byFilename.set(fn, []);
      byFilename.get(fn).push(x);
    }
    for (const track of byAnlz.values()) {
      if (!track.filename) continue;
      const candidates = byFilename.get(track.filename.toLowerCase()) || [];
      let best = null;
      if (candidates.length === 1) best = candidates[0];
      else if (candidates.length > 1) {
        // Disambiguate by duration when we know it; otherwise take the first and warn.
        if (track.durationMs) {
          best = candidates.find(
            (c) => c.totalTimeSec && Math.abs(c.totalTimeSec * 1000 - track.durationMs) < 3000
          ) || candidates[0];
        } else best = candidates[0];
        warnings.push(`multiple XML tracks share filename "${track.filename}"; matched "${best.name}"`);
      }
      if (!best) continue;
      track.meta = {
        name: best.name || null,
        artist: best.artist || null,
        album: best.album || null,
        genre: best.genre || null,
        year: best.year || null,
      };
      if (!track.durationMs && best.totalTimeSec) track.durationMs = best.totalTimeSec * 1000;
      if (!track.audioPath && best.location) {
        try { if (fs.statSync(best.location).isFile()) track.audioPath = best.location; } catch { /* stale */ }
      }
      if (!track.sources.includes('xml')) track.sources.push('xml');
    }
  }

  const tracks = [...byAnlz.values()];
  tracks.forEach((t) => { t.displayName = displayNameOf(t); });
  tracks.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { tracks, warnings };
}

function displayNameOf(track) {
  if (track.meta.artist && track.meta.name) return `${track.meta.artist} - ${track.meta.name}`;
  if (track.meta.name) return track.meta.name;
  if (track.audioPath) return path.basename(track.audioPath, path.extname(track.audioPath));
  if (track.filename) return track.filename.replace(/\.[^.]+$/, '');
  return path.basename(path.dirname(track.anlzDat));
}

module.exports = {
  discoverTracks,
  defaultAnlzRoots,
  defaultManageDbs,
  readManageTbl,
  scanAnlzRoot,
};
