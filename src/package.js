'use strict';
// Song-folder packaging: pad + transcode audio with ffmpeg, write chart and ini.
//
// Audio policy: ALWAYS transcode to Ogg Vorbis q8, even when the source is already
// ogg. Two reasons: (1) the lead-in silence pad must be baked into the audio so the
// chart needs no offset; (2) mp3 passthrough risks the documented ~26 ms grid shift
// from divergent LAME encoder-delay handling between decoders — rekordbox's beat
// times are measured against rekordbox's own decode.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function ffmpegAvailable(ffmpegBin) {
  const r = spawnSync(ffmpegBin, ['-version'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

/**
 * @param {object} o
 * @param {string}  o.outDir       song folder to create
 * @param {string}  o.chartText
 * @param {string}  o.iniText
 * @param {string} [o.audioPath]   source audio (required unless chartOnly)
 * @param {number} [o.padMs=0]     silence to prepend
 * @param {boolean}[o.chartOnly]
 * @param {boolean}[o.force]       overwrite an existing notes.chart
 * @param {string} [o.ffmpegBin='ffmpeg']
 * @returns {{outDir:string, files:string[], warnings:string[]}}
 */
function packageSong(o) {
  const warnings = [];
  const files = [];
  fs.mkdirSync(o.outDir, { recursive: true });

  const chartPath = path.join(o.outDir, 'notes.chart');
  // A pre-existing notes.chart may hold hours of placed notes — never clobber it
  // silently. (song.ogg/song.ini are regenerable, notes are not.)
  if (!o.force && fs.existsSync(chartPath)) {
    throw new Error(
      `${chartPath} already exists — it may contain charted notes. ` +
      'Re-run with --force to overwrite, or use a different --out folder.'
    );
  }
  fs.writeFileSync(chartPath, o.chartText, 'utf8');
  files.push(chartPath);

  const iniPath = path.join(o.outDir, 'song.ini');
  fs.writeFileSync(iniPath, o.iniText, 'utf8');
  files.push(iniPath);

  if (o.chartOnly) {
    if (o.padMs > 0) {
      warnings.push(
        `chart assumes ${o.padMs} ms of silence prepended to the audio — ` +
        'add it yourself or re-run without --chart-only'
      );
    }
    return { outDir: o.outDir, files, warnings };
  }

  if (!o.audioPath) throw new Error('no audio file (use --audio, or --chart-only to skip packaging)');
  if (!fs.existsSync(o.audioPath)) throw new Error(`audio file not found: ${o.audioPath}`);
  const ffmpegBin = o.ffmpegBin || 'ffmpeg';
  if (!ffmpegAvailable(ffmpegBin)) {
    throw new Error(
      'ffmpeg not found on PATH. Install it (https://ffmpeg.org, winget install ffmpeg, ' +
      'brew install ffmpeg) or re-run with --chart-only.'
    );
  }

  const oggPath = path.join(o.outDir, 'song.ogg');
  if (path.resolve(o.audioPath) === path.resolve(oggPath)) {
    throw new Error(
      `--audio points at the output file itself (${oggPath}) — ffmpeg would corrupt it. ` +
      'Point --audio at the original source file instead.'
    );
  }
  const args = ['-hide_banner', '-y', '-i', o.audioPath];
  const padMs = Math.max(0, Math.round(o.padMs || 0));
  if (padMs > 0) args.push('-af', `adelay=${padMs}:all=1`); // all=1 needs ffmpeg >= 4.2
  args.push('-map', '0:a:0', '-c:a', 'libvorbis', '-q:a', '8', oggPath);

  const r = spawnSync(ffmpegBin, args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) {
    const tail = (r.stderr || '').trim().split('\n').slice(-8).join('\n');
    throw new Error(`ffmpeg failed (exit ${r.status}):\n${tail}`);
  }
  files.push(oggPath);
  return { outDir: o.outDir, files, warnings };
}

module.exports = { packageSong, ffmpegAvailable };
