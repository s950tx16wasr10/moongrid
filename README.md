# moongrid

Convert rekordbox beatgrids, including dynamic (variable-tempo) grids, into
Clone Hero `.chart` tempo maps for note authoring in Moonscraper Chart Editor.

rekordbox stores a per-beat analysis grid for every track; in dynamic mode the
grid follows tempo changes beat by beat. Moonscraper has no tempo-mapping
assistance. moongrid converts the rekordbox grid into a Clone Hero song folder
whose `[SyncTrack]` reproduces every rekordbox beat time, leaving only note
placement to do by hand.

[docs/GUIDE.md](docs/GUIDE.md) is a walkthrough from rekordbox analysis to a
playable chart. [docs/DESIGN.md](docs/DESIGN.md) covers file formats and the
conversion math.

## Requirements

- Node.js 18+. With Node 22.5+, moongrid also reads rekordbox's analysis
  registry to locate audio files automatically.
- ffmpeg on PATH for audio packaging (`winget install ffmpeg`,
  `brew install ffmpeg`). Not needed with `--chart-only`.
- rekordbox 5, 6, or 7 with the track analyzed. Use dynamic analysis for
  variable-tempo music. Developed against rekordbox 7.2.

moongrid reads the unencrypted analysis files rekordbox writes to disk. It does
not read the encrypted `master.db` and needs no account or database key.

## Install

```
npm install -g moongrid
```

or from a checkout: `node bin/moongrid.js …`

## Usage

```
moongrid list                     # analyzed tracks with beatgrids
moongrid convert venus            # convert by name match
moongrid convert venus --out "D:\CH Songs\Television - Venus"
```

`convert` writes a song folder:

| file | contents |
|---|---|
| `notes.chart` | `[SyncTrack]` tempo map (BPM events, Moonscraper anchors, TS markers) and song metadata; no notes |
| `song.ogg` | audio transcoded to Ogg Vorbis q8 with the lead-in silence prepended |
| `song.ini` | Clone Hero metadata, `delay = 0` |

Open `notes.chart` in Moonscraper, check the sync with the metronome, and chart.

### Audio file lookup

rekordbox's analysis files identify tracks only by filename. moongrid locates
the audio through, in order:

1. rekordbox's analysis registry (`networkAnalyze6.db`; requires Node 22.5+),
2. a collection XML export (rekordbox: *File > Export Collection in xml
   format*), passed as `--xml collection.xml`; this also supplies
   title/artist/album metadata,
3. `--audio <file>`, which always wins.

With none of these, moongrid writes the chart alone and reports what is
missing.

### USB exports

Device exports carry full audio paths, so both the grid and the audio resolve
from the stick:

```
moongrid list --anlz-dir E:\PIONEER\USBANLZ
moongrid convert "my track" --anlz-dir E:\PIONEER\USBANLZ
```

### Options

```
--xml <file>       rekordbox collection XML (metadata + audio paths; also enables
                   converting tracks that have no ANLZ analysis on this machine)
--audio <file>     audio file override
--out <dir>        output folder (default ./<Artist - Title>)
--name/--artist/--album/--genre/--year/--charter   metadata overrides
--chart-only       skip audio packaging (no ffmpeg needed)
--no-anchors       omit Moonscraper anchor events
--dense            one BPM event per beat instead of segmented tempo regions
--tol <ms>         segmentation tolerance (default 1.0); larger = fewer BPM
                   events, smaller = tighter tracking
--pad-min <ms>     minimum total lead-in (added silence + the track's own intro)
                   before the first beat (default 2000)
--no-pad           leave the audio untouched; fit a lead-in tempo over the intro gap
--force            overwrite an existing notes.chart in the output folder
--index <n>        disambiguate multiple matches
--json             machine-readable output
```

moongrid refuses to overwrite an existing `notes.chart` unless `--force` is
passed, because that file holds any notes placed so far.

## How it works

- rekordbox stores a per-beat grid (beat number in bar, time in integer
  milliseconds) in its `ANLZ0000.DAT` analysis files. This is more precise than
  the XML export, which quantizes BPM to two decimals. moongrid reads the grid
  directly.
- Tempo is derived from the beat timestamps, not rekordbox's displayed BPM
  values.
- `.chart` stores tempo as integer milli-BPM. Rounding each segment
  independently would accumulate drift over hundreds of beats, so each value is
  chosen closed-loop: the rounding error of one segment is cancelled by the
  next. After conversion, every beat time is re-derived from the finished chart
  and the worst deviation is reported. Conversions off by more than 2 ms are
  rejected; measured conversions land in the hundredths of a millisecond.
- The gap before the first beat becomes whole lead-in measures at the song's
  starting tempo, with silence prepended to the audio, so `Offset` and `delay`
  stay 0 as charting conventions require.
- Audio is always re-encoded from the original file. Some mp3s decode with a
  ~26 ms offset difference between decoders, and rekordbox's beat times refer
  to its own decode; re-encoding to Ogg removes the ambiguity.
- Moonscraper anchor events are written alongside tempo events, so the map
  stays locked to the audio during editing. Games ignore anchors. Moonscraper
  drops an anchor that lacks a BPM event at the same tick, so the writer always
  pairs them.

## Limitations

- 4/4 only; rekordbox beatgrids carry no other meter.
- The chart is only as accurate as the rekordbox grid. Fix the grid in
  rekordbox first, then convert.
- `song.ini` metadata is minimal; fill in difficulty details while charting.
- Library auto-detection covers Windows and macOS. On Linux, pass
  `--anlz-dir`/`--xml` explicitly.

## Verifying a conversion

1. The `precision:` line in the output is the maximum difference between chart
   beat times and rekordbox beat times, across all beats.
2. In Moonscraper: enable the metronome and spot-check intro, middle, and
   outro.
3. In Clone Hero: practice mode at 100% speed.

## License

MIT
