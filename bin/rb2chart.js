#!/usr/bin/env node
'use strict';

// Silence the node:sqlite experimental warning (the dependency is optional and
// the warning would just alarm users).
{
  const orig = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...rest) => {
    if (String(warning && warning.message || warning).includes('SQLite is an experimental feature')) return;
    orig(warning, ...rest);
  };
}

const fs = require('fs');
const path = require('path');
const { parseAnlz, pathFilename } = require('../src/anlz');
const { discoverTracks } = require('../src/discover');
const { parseCollectionXml, synthesizeBeats } = require('../src/rbxml');
const { buildTempoMap } = require('../src/tempomap');
const { writeChart } = require('../src/chart');
const { writeSongIni } = require('../src/songini');
const { packageSong } = require('../src/package');
const { verifyTempoMap } = require('../src/verify');

const HELP = `rb2chart — rekordbox beatgrid -> Clone Hero / Moonscraper tempo map

USAGE
  rb2chart list    [options]              List analyzed tracks with beat grids
  rb2chart inspect <query> [options]      Show a track's beat-grid details
  rb2chart convert <query> [options]      Convert to a Clone Hero song folder

<query> matches track title/filename (case-insensitive substring), or is a
direct path to an ANLZ .DAT file.

OPTIONS
  --anlz-dir <dir>    Extra USBANLZ root to scan (repeatable). Use this for USB
                      exports (E:\\PIONEER\\USBANLZ) or non-standard installs.
  --xml <file>        rekordbox collection XML (File > Export Collection in xml
                      format). Supplies title/artist metadata and audio paths,
                      and enables converting tracks with no local ANLZ files.
  --audio <file>      Audio file override (when rekordbox's path is unknown/stale).
  --out <dir>         Output song folder (default: ./<Artist - Title>).
  --name <s> --artist <s> --album <s> --genre <s> --year <s>
                      Metadata overrides for notes.chart and song.ini.
  --charter <s>       Charter name written into the files (default: rb2chart).
  --chart-only        Write notes.chart + song.ini only; skip ffmpeg/audio.
  --no-anchors        Omit Moonscraper anchor (A) events.
  --dense             One BPM event per beat (no segmentation).
  --tol <ms>          Segmentation tolerance in ms (default 1.0). Lower = more
                      BPM events, tighter fit.
  --pad-min <ms>      Minimum lead-in silence (default 2000).
  --no-pad            Never pad audio; fit a lead-in tempo over the intro gap.
  --index <n>         Pick the n-th match (1-based) when several tracks match.
  --json              Machine-readable output.
  -h, --help          This help.

EXAMPLES
  rb2chart list
  rb2chart convert venus
  rb2chart convert "night owl" --xml collection.xml --out "D:\\CH\\Night Owl"
  rb2chart convert E:\\PIONEER\\USBANLZ\\0a1\\...\\ANLZ0000.DAT --audio track.flac
`;

function parseArgv(argv) {
  const args = { _: [], anlzDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`missing value for ${a}`);
      return argv[++i];
    };
    switch (a) {
      case '-h': case '--help': args.help = true; break;
      case '--anlz-dir': args.anlzDirs.push(next()); break;
      case '--xml': args.xml = next(); break;
      case '--audio': args.audio = next(); break;
      case '--out': args.out = next(); break;
      case '--name': args.name = next(); break;
      case '--artist': args.artist = next(); break;
      case '--album': args.album = next(); break;
      case '--genre': args.genre = next(); break;
      case '--year': args.year = next(); break;
      case '--charter': args.charter = next(); break;
      case '--chart-only': args.chartOnly = true; break;
      case '--no-anchors': args.noAnchors = true; break;
      case '--dense': args.dense = true; break;
      case '--tol': args.tol = parseFloat(next()); break;
      case '--pad-min': args.padMin = parseFloat(next()); break;
      case '--no-pad': args.noPad = true; break;
      case '--index': args.index = parseInt(next(), 10); break;
      case '--json': args.json = true; break;
      default:
        if (a.startsWith('--')) fail(`unknown option ${a} (see --help)`);
        args._.push(a);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`rb2chart: ${msg}`);
  process.exit(1);
}

function loadXmlTracks(args) {
  if (!args.xml) return [];
  let text;
  try { text = fs.readFileSync(args.xml, 'utf8'); } catch (e) { fail(`cannot read --xml file: ${e.message}`); }
  const tracks = parseCollectionXml(text);
  if (!tracks.length) fail(`no tracks found in ${args.xml} — is it a rekordbox collection XML?`);
  return tracks;
}

function bpmRange(beats) {
  if (beats.length < 2) return 'n/a';
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < beats.length; i++) {
    const bpm = 60000 / (beats[i].timeMs - beats[i - 1].timeMs);
    if (bpm < lo) lo = bpm;
    if (bpm > hi) hi = bpm;
  }
  return hi - lo < 0.5 ? `${((lo + hi) / 2).toFixed(1)}` : `${lo.toFixed(1)}-${hi.toFixed(1)}`;
}

function cmdList(args) {
  const xmlTracks = loadXmlTracks(args);
  const { tracks, warnings } = discoverTracks({ anlzDirs: args.anlzDirs, xmlTracks });
  if (args.json) {
    console.log(JSON.stringify(tracks.map((t) => ({
      name: t.displayName,
      beats: t.beats.length,
      bpm: bpmRange(t.beats),
      audio: t.audioPath,
      anlz: t.anlzDat,
      sources: t.sources,
    })), null, 2));
  } else {
    if (!tracks.length) {
      console.log('No analyzed tracks found. Point me at a library with --anlz-dir, or use --xml.');
    }
    for (const t of tracks) {
      const audio = t.audioPath ? '' : '  [no audio path — use --xml or --audio]';
      console.log(`${t.displayName}  (${t.beats.length} beats, ${bpmRange(t.beats)} BPM)${audio}`);
    }
    for (const w of warnings) console.error(`warning: ${w}`);
  }
}

function selectTrack(args, query) {
  // Direct ANLZ file path?
  if (/\.dat$/i.test(query) && fs.existsSync(query)) {
    const parsed = parseAnlz(fs.readFileSync(query));
    if (!parsed.beats.length) fail(`${query} contains no beat grid (PQTZ)`);
    return {
      anlzDat: path.resolve(query),
      beats: parsed.beats,
      ppth: parsed.path,
      filename: pathFilename(parsed.path),
      audioPath: null,
      durationMs: null,
      meta: {},
      sources: ['anlz'],
      displayName: pathFilename(parsed.path) || path.basename(query),
    };
  }

  const xmlTracks = loadXmlTracks(args);
  const { tracks, warnings } = discoverTracks({ anlzDirs: args.anlzDirs, xmlTracks });
  for (const w of warnings) console.error(`warning: ${w}`);

  const q = query.toLowerCase();
  let matches = tracks.filter((t) =>
    t.displayName.toLowerCase().includes(q) ||
    (t.filename || '').toLowerCase().includes(q) ||
    (t.audioPath || '').toLowerCase().includes(q)
  );

  // Fall back to XML-only tracks (no ANLZ analysis on this machine).
  if (!matches.length && xmlTracks.length) {
    const xmlMatches = xmlTracks.filter((x) =>
      (x.name || '').toLowerCase().includes(q) ||
      (x.artist || '').toLowerCase().includes(q) ||
      (x.location || '').toLowerCase().includes(q)
    ).filter((x) => x.tempos.length);
    if (xmlMatches.length) {
      matches = xmlMatches.map((x) => ({
        anlzDat: null,
        beats: synthesizeBeats(x.tempos, (x.totalTimeSec || 0) * 1000 || guessDuration(x)),
        ppth: null,
        filename: x.location ? path.basename(x.location) : null,
        audioPath: x.location && fs.existsSync(x.location) ? x.location : null,
        durationMs: (x.totalTimeSec || 0) * 1000 || null,
        meta: { name: x.name, artist: x.artist, album: x.album, genre: x.genre, year: x.year },
        sources: ['xml'],
        displayName: x.artist && x.name ? `${x.artist} - ${x.name}` : (x.name || path.basename(x.location || '?')),
        xmlOnly: true,
      }));
    }
  }

  if (!matches.length) fail(`no track matches "${query}" — run "rb2chart list" to see what's available`);
  if (matches.length > 1 && !args.index) {
    console.error(`"${query}" matches ${matches.length} tracks:`);
    matches.forEach((t, i) => console.error(`  ${i + 1}. ${t.displayName}`));
    fail('narrow the query or pass --index <n>');
  }
  const track = matches[args.index ? args.index - 1 : 0];
  if (!track) fail(`--index out of range (1-${matches.length})`);
  return track;
}

function guessDuration(xmlTrack) {
  // Without TotalTime, extend the grid one minute past the last anchor.
  const last = xmlTrack.tempos[xmlTrack.tempos.length - 1];
  return last ? last.inizioSec * 1000 + 60000 : 0;
}

function cmdInspect(args, query) {
  const t = selectTrack(args, query);
  const beats = t.beats;
  console.log(`track:      ${t.displayName}`);
  console.log(`anlz:       ${t.anlzDat || '(XML-derived)'}`);
  console.log(`audio:      ${t.audioPath || '(unknown — pass --audio or --xml)'}`);
  console.log(`beats:      ${beats.length}`);
  console.log(`first beat: #${beats[0].beatNum} at ${beats[0].timeMs} ms`);
  console.log(`last beat:  ${beats[beats.length - 1].timeMs} ms`);
  console.log(`BPM range:  ${bpmRange(beats)} (from timestamps)`);
  const changes = [];
  for (let i = 2; i < beats.length; i++) {
    const a = 60000 / (beats[i - 1].timeMs - beats[i - 2].timeMs);
    const b = 60000 / (beats[i].timeMs - beats[i - 1].timeMs);
    if (Math.abs(a - b) > 0.5) changes.push(i);
  }
  console.log(`tempo-change points (>0.5 BPM between adjacent intervals): ${changes.length}`);
}

function sanitizeFolderName(s) {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'song';
}

function cmdConvert(args, query) {
  const track = selectTrack(args, query);
  if (track.xmlOnly) {
    console.error('note: converting from XML TEMPO anchors (no ANLZ analysis found); ' +
      'beat times are ms-quantized at anchors only — ANLZ is more precise when available');
  }
  if (!track.beats || track.beats.length < 2) fail('track has no usable beat grid');

  const map = buildTempoMap(track.beats, {
    padMinMs: args.padMin,
    tolMs: args.tol,
    dense: args.dense,
    noPad: args.noPad,
  });
  const check = verifyTempoMap(map.events, map.resolution, map.beatTicks, map.targetTimesMs);
  if (check.maxErrMs > 2) {
    fail(`internal error: tempo map verification failed (max error ${check.maxErrMs.toFixed(3)} ms at beat ${check.worstBeat}) — please report this`);
  }

  const meta = {
    name: args.name || track.meta.name || (track.filename ? track.filename.replace(/\.[^.]+$/, '') : track.displayName),
    artist: args.artist || track.meta.artist || '',
    album: args.album || track.meta.album || '',
    genre: args.genre || track.meta.genre || '',
    year: args.year || track.meta.year || '',
    charter: args.charter || 'rb2chart',
    musicStream: 'song.ogg',
    songLengthMs: track.durationMs ? track.durationMs + map.padMs : null,
  };

  const chartText = writeChart(meta, map.events, {
    resolution: map.resolution,
    anchors: !args.noAnchors,
  });
  const iniText = writeSongIni(meta);

  const outDir = args.out
    ? path.resolve(args.out)
    : path.resolve(sanitizeFolderName(meta.artist ? `${meta.artist} - ${meta.name}` : String(meta.name)));

  const audioPath = args.audio || track.audioPath;
  const pkg = packageSong({
    outDir,
    chartText,
    iniText,
    audioPath,
    padMs: map.padMs,
    chartOnly: !!args.chartOnly || (!audioPath && !args.audio),
  });
  if (!audioPath && !args.chartOnly) {
    pkg.warnings.push('no audio path known for this track — wrote chart only. ' +
      'Pass --audio <file>, or --xml <collection.xml> so I can find it.');
  }

  const allWarnings = [...map.warnings, ...pkg.warnings];
  if (args.json) {
    console.log(JSON.stringify({
      track: track.displayName,
      outDir: pkg.outDir,
      files: pkg.files,
      stats: { ...map.stats, maxErrMs: check.maxErrMs, meanErrMs: check.meanErrMs },
      warnings: allWarnings,
    }, null, 2));
    return;
  }

  console.log(`converted:  ${track.displayName}`);
  console.log(`output:     ${pkg.outDir}`);
  console.log(`beats:      ${map.stats.beats} across ${map.stats.bpmEvents} BPM events (${map.stats.tsEvents} TS)`);
  console.log(`tempo:      ${map.stats.minBpm.toFixed(3)} - ${map.stats.maxBpm.toFixed(3)} BPM, lead-in ${map.stats.leadBpm.toFixed(3)} BPM`);
  console.log(`audio pad:  ${map.padMs} ms of silence prepended`);
  console.log(`precision:  max beat error ${check.maxErrMs.toFixed(3)} ms (mean ${check.meanErrMs.toFixed(3)} ms)`);
  for (const w of allWarnings) console.error(`warning: ${w}`);
  console.log('\nNext: open notes.chart in Moonscraper, turn on the metronome, and start placing notes.');
}

function main() {
  const args = parseArgv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.help || !cmd) { console.log(HELP); process.exit(args.help ? 0 : 1); }
  try {
    if (cmd === 'list') cmdList(args);
    else if (cmd === 'inspect') cmdInspect(args, args._[1] || fail('inspect needs a <query>'));
    else if (cmd === 'convert') cmdConvert(args, args._[1] || fail('convert needs a <query>'));
    else fail(`unknown command "${cmd}" (see --help)`);
  } catch (e) {
    fail(e.message);
  }
}

main();
