'use strict';
// Minimal song.ini for Clone Hero. Tag reference:
// https://github.com/TheNathannator/GuitarGame_ChartFormats/blob/main/docs/Chart-File-Formats/song-ini/Standard-Tags.md
// delay stays 0 by design: sync is baked into the tempo map (delay is discouraged
// and breaks chart-hash integrity for leaderboards).

function writeSongIni(meta) {
  const L = ['[song]'];
  const put = (k, v) => {
    if (v == null || v === '') return;
    L.push(`${k} = ${String(v).replace(/[\r\n]+/g, ' ')}`);
  };
  put('name', meta.name);
  put('artist', meta.artist);
  put('album', meta.album);
  put('genre', meta.genre);
  put('year', meta.year);
  put('charter', meta.charter || 'moongrid');
  put('delay', 0);
  if (meta.songLengthMs) put('song_length', Math.round(meta.songLengthMs));
  put('preview_start_time', -1);
  return L.join('\r\n') + '\r\n';
}

module.exports = { writeSongIni };
