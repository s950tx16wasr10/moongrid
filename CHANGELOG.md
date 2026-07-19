# Changelog

## 0.1.0 (unreleased)

Initial release. Developed under the working name rb2chart.

- Read beatgrids from rekordbox ANLZ analysis files (local libraries and USB
  exports), rekordbox collection XML, or a direct `.DAT` path.
- Audio-path resolution via rekordbox's analysis registry (`networkAnalyze6.db`),
  collection XML, USB-export paths, or `--audio`.
- Drift-free `.chart` [SyncTrack] generation: closed-loop milli-BPM rounding,
  tempo-region segmentation, Moonscraper anchors, TS re-anchoring across grid
  discontinuities, pickup-beat handling.
- Lead-in handling with audio silence padding (`Offset`/`delay` stay 0), or
  `--no-pad` to keep audio untouched.
- ffmpeg packaging to Ogg Vorbis q8 + `song.ini`.
- Built-in verification: reconstructs every beat time from the emitted chart and
  reports the maximum error; refuses to write charts off by more than 2 ms.
- Overwrite protection: an existing `notes.chart` is never replaced without
  `--force`.
- Robustness: metadata sanitized against chart/ini corruption, XML parsing
  tolerates `>` inside attribute values, corrupt ANLZ files cannot crash the
  parser, rekordbox 5-style absolute analysis paths resolve on Windows,
  numeric CLI options are validated, malformed XML tempos cannot generate
  unbounded beat lists, ffmpeg cannot be pointed at its own output file,
  Windows reserved device names are avoided in folder names.
- Fuzz harness (`npm run fuzz`): random hostile beatgrids round-tripped
  through serialized chart text, ANLZ byte mutations, hostile XML tempo
  anchors; also runs (briefly) in CI.
- Step-by-step user guide in `docs/GUIDE.md`.
