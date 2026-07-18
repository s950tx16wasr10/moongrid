# rekordbox → Moonscraper tempo-map bridge — Plan

## Goal

Use rekordbox's beatgrid analysis (including dynamic, variable-tempo grids) as the tempo
map for Clone Hero charts authored in Moonscraper. The tool (`rb2chart`) reads a track's
rekordbox beat grid and emits a ready-to-author Clone Hero song folder:

- `notes.chart` with a `[SyncTrack]` that locks every beat to the audio
- `song.ogg` transcoded from the source audio
- `song.ini` with basic metadata

You then open the chart in Moonscraper and only place notes — the tempo map is already done.

## Where the data lives (verified on this machine)

rekordbox stores a **per-beat** grid in binary analysis files, far more precise than
anything it shows in the UI:

- Location: `%APPDATA%\Pioneer\rekordbox\share\PIONEER\USBANLZ\<xxx>\<uuid>\ANLZ0000.DAT`
  (35 tracks currently analyzed on this machine)
- The `PQTZ` tag holds one 8-byte entry **per beat**: beat number in bar (u16, 1–4),
  tempo (u16, BPM×100), time (u32, integer milliseconds). Big-endian throughout.
  Format ref: https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/anlz.html
- The `PPTH` tag in the same file holds the audio file path (UTF-16BE), so **no database
  access is needed** — we can scan the USBANLZ folder and match tracks by name/path.
  (`master.db` is SQLCipher-encrypted; avoiding it removes the riskiest dependency.
  pyrekordbox's leaked key is unverified for rekordbox 7.1+.)
- Verified with a spike script ([scratchpad] `anlz_peek.js`) against the freshly mapped
  track `Venus.mp3` (ANLZ dir `32f\7bc52-8b64-4eac-83ca-11db8598677a`): 441 beats,
  104 tempo regions, 112.74–117.36 BPM stored tempo. Dynamic grids are real per-beat data.

**Design rule:** derive tempo from successive beat *timestamps* (millisecond-exact), not
from the stored tempo field (quantized to 0.01 BPM and only an estimate rekordbox
refreshes every ~4 beats).

Fallback input (no ANLZ access, e.g. another machine): rekordbox XML export
(`File > Export Collection in xml format`, rekordbox 6.3+/7). `TEMPO` elements are
piecewise anchors — `Inizio` (seconds, 3 decimals), `Bpm` (2 decimals), `Battito`
(beat-in-bar). Less precise than ANLZ; support it as a secondary mode.

## Target format (.chart) — verified specifics

Spec: https://github.com/TheNathannator/GuitarGame_ChartFormats

- `[Song]`: `Resolution = 192` (ticks per quarter note, Moonscraper's standard),
  `Offset = 0` always (Clone Hero reads Offset/delay, but community & CSC convention is
  zero — sync gets baked into the tempo map instead), `MusicStream = "song.ogg"`.
- `[SyncTrack]` events, all at integer ticks:
  - `<tick> = B <bpm*1000>` — tempo as integer milli-BPM. Required at tick 0.
  - `<tick> = TS <numerator>` — time signature. Required at tick 0. rekordbox grids are
    4/4-only (beat numbers cycle 1–4), so always `0 = TS 4`.
  - `<tick> = A <microseconds>` — Moonscraper anchor: locks that BPM marker to an
    absolute audio time so later edits can't shift it. Games ignore it.
    **Must always be paired with a `B` at the exact same tick** — Moonscraper silently
    drops orphan anchors (verified in ChartReader.cs).
- Dense tempo maps are fine: no event-count limit in the spec, Moonscraper, or
  Clone Hero (parser rewritten for performance in CH v1.1). One `B` per beat is normal
  community practice. Keep every BPM ≤ 999.999 (Moonscraper UI cap).

## Conversion math (the core of the tool)

Tick placement: beat *i* goes at tick `T0 + i·192`. All downbeats (beat number 1) must
land on measure boundaries (multiples of 768).

**Drift-free BPM rounding (closed-loop feedback):** milli-BPM quantization error would
accumulate over hundreds of beats if each segment were rounded independently. Instead:

```
chartTime = leadInDuration            // running time implied by already-emitted values
for each beat i (going forward):
    exact  = 60000 / (t[i+1] - chartTime)          // ms → BPM that lands beat i+1 on time
    B[i]   = round(exact * 1000)                    // integer milli-BPM
    chartTime += (60000 / (B[i]/1000)) * (192/192)  // advance by one beat at emitted BPM
```

Each beat's residual error (< ~0.3 ms) is absorbed by the next segment's value, so error
never accumulates. Coalesce consecutive identical `B` values into one event. Emit an `A`
anchor (audio time in µs) alongside the `B` at least at every downbeat so the chart stays
safely editable in Moonscraper.

**Intro before the first beat:** the first PQTZ beat is at an arbitrary offset (195 ms for
Venus). Strategy — since we transcode audio anyway, pad the start with silence so the
lead-in is exact and musical:

1. Let `bpm₁` = tempo of the first beat segment, `t₁` = first-beat time.
2. Choose `k` = smallest whole number of measures such that `k · 4 · 60/bpm₁ ≥ t₁ + 2s`
   (≥2 s of pre-roll is charting convention).
3. Pad audio start by `k · 4 · 60/bpm₁ − t₁` (ffmpeg `adelay`), shift all beat times by
   the same amount, and set the tick-0 BPM to `bpm₁`.

Result: lead-in plays at the song's own tempo, first downbeat lands exactly on measure
`k`, Offset stays 0, no >999 BPM hacks needed for short intros.

If the first beat's beat-number ≠ 1, extend the lead-in by the missing beats so downbeats
stay on measure boundaries.

**Audio:** always transcode to `song.ogg` (Vorbis q8) with ffmpeg from the original file.
Never pass mp3 through: ~6% of mp3s have a ~26 ms grid shift between decoders due to
LAME encoder-delay tag divergence, and rekordbox's beat times are measured against its
own decode. (Verify on first tracks with the click-track check below.)

## Architecture

Node.js CLI (Node 18+ present via Volta; no real Python on this machine — the WindowsApps
`python.exe` is the Store stub). Plain JS or TypeScript, zero native deps; ffmpeg (present)
invoked as a subprocess.

```
rb2chart list                          # scan USBANLZ, show analyzed tracks (name, BPM range, beats)
rb2chart convert "<track name>"        # full pipeline → Clone Hero song folder
   [--out <dir>]                       # default: Documents\Clone Hero\Songs\<Artist - Title>
   [--audio <file>]                    # override if PPTH path is stale/odd
   [--xml <collection.xml>]            # fallback input mode
   [--smooth <milli-bpm>]              # optional: merge sub-threshold BPM wobble
   [--click]                           # also render click-track verification mix
```

Modules:
1. `anlz.js` — ANLZ parser (tag walker, PQTZ, PPTH). Already 80% proven by the spike.
2. `discover.js` — scan USBANLZ recursively, index tracks by PPTH path/filename.
3. `tempomap.js` — beats → {tick, milliBPM, anchorµs} list (feedback algorithm + lead-in).
4. `chart.js` — `.chart` writer ([Song]/[SyncTrack]/[Events] skeleton).
5. `package.js` — ffmpeg transcode + silence pad, song.ini, output folder.
6. `verify.js` — recompute every beat time from the emitted SyncTrack via the spec's
   tick→seconds formula; assert |error| < 1 ms vs the (shifted) PQTZ table. `--click`
   renders an audible click overlay at PQTZ times.

## Milestones

- **M0 — spike (done 2026-07-18):** parsed PQTZ + PPTH from the local library with Node;
  confirmed dynamic grid data for Venus.mp3.
- **M1 — reader + discovery:** `rb2chart list` works against the real library; handles
  UTF-16 paths correctly (spike printed `?/Venus.mp3` — likely a console-encoding artifact
  or short/relative PPTH; resolve properly, with `--audio` as escape hatch).
- **M2 — tempo map + chart writer + verify:** unit tests on synthetic grids (constant,
  ramp, wobble, missing-downbeat start) asserting <1 ms reconstruction; Venus.mp3 as the
  integration fixture. Open result in Moonscraper: metronome must sit on the music.
- **M3 — packaging:** ffmpeg pad+transcode, song.ini, output into Clone Hero songs dir;
  end-to-end test in Clone Hero practice mode.
- **M4 — QoL:** XML input mode, `--smooth`, batch convert, album art from
  `share\PIONEER\Artwork`, optional master.db metadata via pyrekordbox if ever needed.

## Risks / open questions

- **PPTH path oddity** — the spike printed `?/Venus.mp3`; needs one debug pass (encoding
  vs. genuinely short stored path). Mitigations: filename matching + `--audio` override.
- **Clone Hero's mp3/ogg decoder delay behavior is undocumented** — mitigated by always
  transcoding + the click-track verification per song.
- **Non-4/4 songs** — rekordbox can't grid them; out of scope (document it).
- **.2EX/.3EX files** (newer rekordbox) — ignored; PQTZ in `.DAT` is sufficient.
- **PQT2 extended grid in .EXT** — undocumented semantics; ignored deliberately.

## Verification checklist per converted song

1. Tool self-check: max |reconstructed − PQTZ| beat time error reported, must be < 1 ms.
2. Moonscraper: enable metronome, spot-check intro / mid / outro.
3. Clone Hero practice mode at 100% speed with hit sounds.
