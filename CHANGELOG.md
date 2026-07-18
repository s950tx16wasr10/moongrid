# Changelog

## 0.1.0 (unreleased)

Initial release.

- Read beat grids from rekordbox ANLZ analysis files (local libraries and USB
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
