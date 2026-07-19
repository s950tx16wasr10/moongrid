# moongrid design notes

Where the data comes from, what the output format requires, and how the
conversion stays accurate. Usage instructions are in [GUIDE.md](GUIDE.md).

## Data sources

### ANLZ beatgrid (primary)

rekordbox writes per-track analysis files named `ANLZnnnn.DAT` / `.EXT` under
`share/PIONEER/USBANLZ` (local libraries) or `PIONEER/USBANLZ` (device
exports). The format is big-endian: a `PMAI` file header followed by tagged
sections, each starting with a fourcc, a header length, and a total length.
Format reference: <https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/anlz.html>

moongrid reads two tags:

- `PQTZ`, the beatgrid: 8 bytes per beat — beat number within the bar (u16,
  1–4), tempo (u16, BPM × 100), time from track start (u32, integer
  milliseconds).
- `PPTH`, the audio file path (UTF-16BE). Local rekordbox 6/7 libraries redact
  the directory to `?/filename.ext` (confirmed at byte level against real
  libraries); device exports carry full `/Contents/...` paths; rekordbox 5
  wrote absolute paths.

The PQTZ tempo field is quantized to 0.01 BPM, so segment tempos are derived
from the millisecond timestamps instead. The undocumented `PQT2` extended grid
in `.EXT` files is ignored.

### Audio path resolution

Because local `PPTH` paths are redacted, the audio file is located through:

1. `networkAnalyze6.db`, a plain SQLite database next to the library:
   `manage_tbl` maps `SongFilePath` to `AnalyzeFilePath`, with `Duration` in
   milliseconds. Read with `node:sqlite` (Node 22.5+).
2. A collection XML export: the `TRACK` `Location` URI, matched to grids by
   filename; also supplies metadata. `TEMPO` elements (`Inizio` in seconds,
   `Bpm`, `Metro`, `Battito`) serve as a fallback grid when no ANLZ file
   exists, expanded to per-beat times.
3. The `--audio` override.

## Target format

`.chart`, per <https://github.com/TheNathannator/GuitarGame_ChartFormats>:

- `Resolution = 192` ticks per quarter note (Moonscraper's default).
- `<tick> = B <bpm*1000>`: tempo as integer milli-BPM. Required at tick 0.
- `<tick> = TS 4` at tick 0. rekordbox grids are 4/4 only.
- `<tick> = A <microseconds>`: Moonscraper anchor, locking the paired B event
  to an audio time. Games ignore anchors. Moonscraper discards an `A` without a
  `B` at the same tick, so the writer always emits them as a pair, `A` directly
  after its `B`.
- `Offset` and `song.ini` `delay` stay 0. Charting conventions discourage both,
  and `delay` breaks chart-hash comparability between players.

## Conversion

- Beat *i* sits at tick `leadTicks + i × 192`. Downbeats land on 768-tick
  measure boundaries; a pickup first beat (beat number ≠ 1) shifts the lead-in
  by its bar phase.
- Lead-in: the gap before the first beat is covered by whole measures at the
  track's starting tempo (averaged over the first 8 intervals). Silence is
  prepended to the audio so the measure count works out exactly, with total
  lead-in of at least `--pad-min` (default 2 s). `--no-pad` instead fits a
  lead-in tempo over the original gap and fails when that tempo would exceed
  999.999 BPM, Moonscraper's cap.
- Closed-loop rounding: each emitted milli-BPM value is chosen so the next
  segment boundary lands on its true time given all previously emitted values.
  The residual per boundary stays below one rounding step and does not
  accumulate.
- Segmentation: runs of beats that fit a straight line within `--tol` (default
  1 ms) collapse into one BPM event. Static grids produce a handful of events;
  dynamic grids stay as dense as needed. `--dense` emits one event per beat.
- Bar-phase discontinuities (manual grid edits that restart the 1–4 beat cycle
  mid-bar) get a `TS 4` re-anchor at the offending downbeat so barlines stay
  aligned.
- Audio is re-encoded to Ogg Vorbis q8 with ffmpeg. mp3 passthrough is avoided:
  LAME encoder-delay tag handling differs between decoders by ~26 ms on a
  minority of files, and rekordbox's timestamps refer to its own decode.

## Verification

- After building the map, the converter re-derives every beat time from the
  emitted events using the spec's piecewise tick-to-seconds conversion and
  rejects the conversion if any beat is off by more than 2 ms. Measured
  conversions land in the hundredths of a millisecond.
- `test/fuzz.js` runs seeded fuzzing over hostile grids (extreme tempos, grid
  restarts, millisecond collisions) round-tripped through serialized chart
  text, plus ANLZ byte mutations and hostile XML tempo lists.
- CI runs the unit suite and a short fuzz pass on Linux, macOS, and Windows
  across Node 18/20/22.

## Status

Implemented: ANLZ/XML/registry discovery, conversion, packaging (Ogg +
`song.ini`), the verification gate, the fuzz harness, and CI.

Possible extensions, not implemented: tempo smoothing beyond `--tol`, batch
conversion, album art, MIDI tempo-map or osu! timing-point output.

## Known limitations

- 4/4 grids only.
- Grid quality depends entirely on rekordbox's analysis.
- Clone Hero's handling of mp3 encoder delay is undocumented. Re-encoding
  sidesteps the question, but in-game click alignment has no automated test.
- Unknown PQTZ header fields are treated as opaque; `PQT2` is ignored.
