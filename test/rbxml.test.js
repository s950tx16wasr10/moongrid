'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCollectionXml, synthesizeBeats, locationToPath } = require('../src/rbxml');

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1,0,0">
  <COLLECTION Entries="2">
    <TRACK TrackID="1" Name="Venus &amp; Mars" Artist="Television" Album="Marquee Moon"
      Genre="Rock" Year="1977" TotalTime="231"
      Location="file://localhost/C:/Music/Venus%20%26%20Mars.mp3">
      <TEMPO Inizio="0.195" Bpm="113.62" Metro="4/4" Battito="1"/>
      <TEMPO Inizio="20.868" Bpm="118.00" Metro="4/4" Battito="2"/>
    </TRACK>
    <TRACK TrackID="2" Name="Comma Decimals" Artist="Spec" TotalTime="120"
      Location="file://localhost/C:/tmp/comma.mp3">
      <TEMPO Inizio="0,5" Bpm="120,00" Metro="4/4" Battito="1"/>
    </TRACK>
  </COLLECTION>
</DJ_PLAYLISTS>`;

test('parses TRACK attrs, TEMPO children, entities, and comma decimals', () => {
  const tracks = parseCollectionXml(XML);
  assert.equal(tracks.length, 2);
  const [a, b] = tracks;
  assert.equal(a.name, 'Venus & Mars');
  assert.equal(a.artist, 'Television');
  assert.equal(a.totalTimeSec, 231);
  assert.equal(a.tempos.length, 2);
  assert.equal(a.tempos[0].inizioSec, 0.195);
  assert.equal(a.tempos[1].battito, 2);
  assert.ok(a.location.endsWith('Venus & Mars.mp3'), a.location);
  // Spec permits comma decimal separators.
  assert.equal(b.tempos[0].inizioSec, 0.5);
  assert.equal(b.tempos[0].bpm, 120);
});

test('synthesizes per-beat times from piecewise anchors', () => {
  const tempos = [
    { inizioSec: 0.5, bpm: 120, metro: '4/4', battito: 1 },
    { inizioSec: 10.5, bpm: 60, metro: '4/4', battito: 1 },
  ];
  const beats = synthesizeBeats(tempos, 20500);
  // Region 1: 120 BPM from 500ms to 10500ms -> 20 beats (500, 1000, ... 10000)
  // Region 2: 60 BPM from 10500 to 20500 -> 10 beats
  assert.equal(beats.length, 30);
  assert.equal(beats[0].timeMs, 500);
  assert.equal(beats[1].timeMs, 1000);
  const r2 = beats.filter((b) => b.timeMs >= 10500);
  assert.equal(r2[0].timeMs, 10500);
  assert.ok(Math.abs(r2[1].timeMs - 11500) < 0.001);
  // Battito phase respected: first beat of each region is a downbeat here.
  assert.equal(beats[0].beatNum, 1);
});

test('raw ">" inside attribute values does not break parsing', () => {
  const xml = `<DJ_PLAYLISTS Version="1,0,0"><COLLECTION>
    <TRACK TrackID="1" Name="A > B" Comments="x>y>z"
      Location="file://localhost/C:/tmp/a.mp3"/>
    <TRACK TrackID="2" Name="Second" Location="file://localhost/C:/tmp/b.mp3">
      <TEMPO Inizio="1.0" Bpm="120.00" Metro="4/4" Battito="1"/>
    </TRACK>
  </COLLECTION></DJ_PLAYLISTS>`;
  const tracks = parseCollectionXml(xml);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].name, 'A > B');
  assert.equal(tracks[1].name, 'Second');
  assert.equal(tracks[1].tempos.length, 1);
});

test('locationToPath handles URI escapes and platforms', () => {
  assert.equal(
    locationToPath('file://localhost/C:/Users/x/My%20Track.mp3').replace(/\\/g, '/'),
    'C:/Users/x/My Track.mp3'
  );
  const posix = locationToPath('file://localhost/Users/x/Music/t.aiff');
  assert.ok(posix.replace(/\\/g, '/').endsWith('/Users/x/Music/t.aiff'));
});
