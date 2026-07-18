# moongrid

Convert **rekordbox beatgrids** — including dynamic, variable-tempo grids — into
**Clone Hero** `.chart` tempo maps ready for note authoring in **Moonscraper Chart
Editor**.

rekordbox's tempo analysis is excellent and its dynamic beatgrids track live
drummers beat by beat. Moonscraper has no tempo-mapping help at all. moongrid
bridges the two: analyze the song in rekordbox (fix the grid there if needed),
run one command, and get a Clone Hero song folder whose tempo map locks every
beat to the audio with sub-millisecond accuracy — so you only have to place notes.

**New to this? Read the [step-by-step guide](docs/GUIDE.md)** — from installing
the tools to a playable chart, including rekordbox dynamic-analysis setup and
troubleshooting.

## Requirements

- **Node.js 18+** (Node **22.5+** recommended — enables automatic audio-path
  lookup from rekordbox's analysis database)
- **ffmpeg** on PATH (for audio packaging; `winget install ffmpeg` /
  `brew install ffmpeg`). Not needed with `--chart-only`.
- **rekordbox 6 or 7** with the track analyzed (dynamic analysis recommended for
  variable-tempo music). Tested against rekordbox 7.2.

No account, no rekordbox database key, no decryption: moongrid reads only the
unencrypted analysis files rekordbox writes on disk.

## Install

```
npm install -g moongrid
```

or run from a checkout: `node bin/moongrid.js …`

## Usage

```
moongrid list                     # what's analyzed and convertible?
moongrid convert venus            # convert by name match
moongrid convert venus --out "D:\CH Songs\Television - Venus"
```

`convert` writes a song folder containing:

| file | contents |
|---|---|
| `notes.chart` | `[SyncTrack]` tempo map (one BPM event per tempo change, Moonscraper anchor events, TS markers), song metadata, no notes yet |
| `song.ogg` | your audio, transcoded to Ogg Vorbis q8, with the lead-in silence baked in |
| `song.ini` | Clone Hero metadata, `delay = 0` always |

Open `notes.chart` in Moonscraper, enable the metronome to sanity-check, and chart.

### Where the audio path comes from

rekordbox's analysis files identify tracks only by filename, so moongrid finds
the actual audio through (in order):

1. **rekordbox's analysis registry** (`networkAnalyze6.db`, automatic, Node 22.5+),
2. **a collection XML export** — `File > Export Collection in xml format` in
   rekordbox, then pass `--xml collection.xml` (also supplies title/artist/album
   metadata),
3. **`--audio <file>`** — explicit override, always wins.

If none is available, moongrid writes the chart anyway (`--chart-only` behavior)
and tells you what's missing.

### USB exports

Exported a USB stick from rekordbox? Point moongrid at it — device exports carry
full audio paths, so the audio resolves from the stick itself:

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
--tol <ms>         segmentation tolerance (default 1.0); larger = fewer, smoother
                   BPM events, smaller = tighter tracking
--pad-min <ms>     minimum total lead-in (added silence + the track's own intro)
                   before the first beat (default 2000)
--no-pad           never touch the audio; fit a lead-in tempo over the intro gap
--force            overwrite an existing notes.chart in the output folder
--index <n>        disambiguate multiple matches
--json             machine-readable output
```

moongrid refuses to overwrite an existing `notes.chart` (it may contain your
charted notes) unless you pass `--force`.

## How it works (and why you can trust the sync)

- rekordbox stores a **per-beat grid** (beat number in bar, time in integer
  milliseconds) in its `ANLZ0000.DAT` analysis files — far more precise than the
  2-decimal BPMs in the XML export. moongrid reads that grid directly.
- Tempo is derived from the **beat timestamps**, not rekordbox's displayed BPM.
- `.chart` files store tempo as integer milli-BPM. Naive rounding accumulates
  drift over hundreds of beats; moongrid chooses each tempo value **closed-loop**
  so every rounding error is cancelled at the next beat. The tool then re-derives
  every beat time from the finished chart and reports the worst deviation
  (typically < 0.05 ms; it refuses to write a chart worse than 2 ms).
- The gap before the first beat becomes whole lead-in measures at the song's own
  starting tempo, with silence baked into the audio so `Offset` and `delay` stay
  **0** (as charting conventions require).
- Audio is always re-encoded from the original file. This isn't laziness — some
  mp3s decode with a ~26 ms offset difference between decoders, and rekordbox's
  beat times refer to *its* decode. Re-encoding to Ogg pins everything down.
- Moonscraper **anchor** events are written alongside every tempo event, so the
  map stays locked to the audio even while you edit BPMs in the editor. (Games
  ignore anchors; Moonscraper requires them paired with a BPM event, which
  moongrid guarantees.)

## Limitations

- **4/4 only** — rekordbox beatgrids are inherently 4/4. (Charting odd meters
  needs a different source of truth.)
- The grid is only as good as rekordbox's analysis: fix the grid in rekordbox
  first, re-analyze, then convert.
- `song.ini` metadata is minimal; fill in difficulty/genre details as you chart.
- Windows and macOS library auto-detection; on Linux point at the files with
  `--anlz-dir` / `--xml`.

## Verifying a conversion

1. moongrid's own check: the `precision:` line in the output is the maximum
   difference between the chart's beat times and rekordbox's, across all beats.
2. In Moonscraper: enable the metronome and spot-check intro, middle, outro.
3. In Clone Hero: practice mode at 100 % speed.

## License

MIT
