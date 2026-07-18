'use strict';
// .chart writer. Format: https://github.com/TheNathannator/GuitarGame_ChartFormats
//
// [SyncTrack] events emitted:
//   <tick> = TS 4            time signature (rekordbox grids are always 4/4)
//   <tick> = B <milliBPM>    tempo
//   <tick> = A <microsec>    Moonscraper anchor: locks the B at the same tick to an
//                            absolute audio time. Games ignore anchors; Moonscraper
//                            silently DROPS an A with no B at the same tick, so the
//                            writer only emits A alongside a B, after its B line.

function esc(s) {
  return String(s == null ? '' : s).replace(/"/g, "'");
}

/**
 * @param {object} meta {name, artist, album, genre, year, charter, musicStream, offset}
 * @param {Array<{tick:number,type:'B'|'TS',value:number,anchorUs?:number}>} syncEvents
 * @param {object} [opts] {resolution=192, anchors=true}
 */
function writeChart(meta, syncEvents, opts = {}) {
  const resolution = opts.resolution || 192;
  const anchors = opts.anchors !== false;
  const L = [];

  L.push('[Song]', '{');
  L.push(`  Name = "${esc(meta.name)}"`);
  L.push(`  Artist = "${esc(meta.artist)}"`);
  L.push(`  Charter = "${esc(meta.charter || 'rb2chart')}"`);
  L.push(`  Album = "${esc(meta.album)}"`);
  L.push(`  Year = "${esc(meta.year ? `, ${meta.year}` : '')}"`);
  L.push('  Offset = 0');
  L.push(`  Resolution = ${resolution}`);
  L.push('  Player2 = bass');
  L.push('  Difficulty = 0');
  L.push('  PreviewStart = 0');
  L.push('  PreviewEnd = 0');
  L.push(`  Genre = "${esc(meta.genre)}"`);
  L.push('  MediaType = "cd"');
  L.push(`  MusicStream = "${esc(meta.musicStream || 'song.ogg')}"`);
  L.push('}');

  L.push('[SyncTrack]', '{');
  const sorted = [...syncEvents].sort((a, b) => a.tick - b.tick || tsFirst(a) - tsFirst(b));
  for (const ev of sorted) {
    if (ev.type === 'TS') {
      L.push(`  ${ev.tick} = TS ${ev.value}`);
    } else if (ev.type === 'B') {
      L.push(`  ${ev.tick} = B ${ev.value}`);
      if (anchors && ev.anchorUs != null) L.push(`  ${ev.tick} = A ${ev.anchorUs}`);
    }
  }
  L.push('}');

  L.push('[Events]', '{', '}');
  return L.join('\r\n') + '\r\n';
}

function tsFirst(e) {
  return e.type === 'TS' ? 0 : 1;
}

module.exports = { writeChart };
