# moongrid guide

moongrid converts the beatgrid rekordbox produces during track analysis into a
Clone Hero song folder with the tempo map already in place. Note authoring
happens in Moonscraper afterwards.

Pipeline: rekordbox analyzes, moongrid converts, Moonscraper charts, Clone Hero
plays.

## Requirements

| tool | purpose | notes |
|---|---|---|
| [rekordbox](https://rekordbox.com) 5/6/7 | tempo analysis | the free plan covers analysis and XML export |
| [Node.js](https://nodejs.org) 18+ | runs moongrid | 22.5+ adds automatic audio-file lookup |
| [ffmpeg](https://ffmpeg.org) | audio packaging | `winget install ffmpeg` / `brew install ffmpeg`; not needed with `--chart-only` |
| [Moonscraper Chart Editor](https://github.com/FireFox2000000/Moonscraper-Chart-Editor) | note authoring | |
| [Clone Hero](https://clonehero.net) | playing the result | |

Install moongrid:

```
npm install -g moongrid
```

## Step 1: get the beatgrid right in rekordbox

The chart reproduces the rekordbox grid exactly, so grid errors carry into the
chart.

1. Drag the audio file into the rekordbox collection. Analysis runs
   automatically.
2. For variable-tempo material (live drummers, older recordings), set
   *Preferences > Analysis > Track Analysis Mode > Dynamic*, then right-click
   the track and choose *Analyze Track* to re-analyze. The default Normal mode
   suits quantized music and produces a single BPM.
3. Load the track onto a deck and check the beat markers against the audio at
   the intro, middle, and outro. Grid-edit mode has a metronome click for this.
4. Correct errors with the GRID panel (nudge, shift, tap) before converting.

## Step 2: convert

List analyzed tracks:

```
moongrid list
```

Convert (matches title and filename, case-insensitive):

```
moongrid convert venus
```

The output folder contains `notes.chart` (tempo map, no notes), `song.ogg`
(audio with the lead-in prepended), and `song.ini`. The `precision:` line in
the output is the worst difference between chart beat times and rekordbox beat
times across the whole track, typically a few hundredths of a millisecond.
Conversions off by more than 2 ms are rejected.

Common variants:

```
# metadata from a collection XML (rekordbox: File > Export Collection in xml format)
moongrid convert venus --xml collection.xml

# metadata by hand
moongrid convert venus --artist "Television" --album "Marquee Moon" --year 1977

# from a USB stick exported by rekordbox (audio resolves from the stick)
moongrid convert "my track" --anlz-dir E:\PIONEER\USBANLZ

# explicit audio file, when rekordbox's stored path is missing or stale
moongrid convert venus --audio "D:\Music\Venus.flac"

# chart only, no audio processing (no ffmpeg required)
moongrid convert venus --chart-only

# leave the audio untouched; requires a long enough intro before beat 1
moongrid convert venus --no-pad
```

Converting into the same folder again requires `--force`. moongrid does not
overwrite an existing `notes.chart` on its own, since that file holds any
placed notes.

## Step 3: chart in Moonscraper

Open `notes.chart`. Before placing notes, turn on the metronome and check the
sync at the intro, middle, and outro.

Dynamically analyzed songs produce many BPM markers, sometimes one per beat.
This is the converted tempo map; leave it in place. The markers carry anchors
(absolute audio times), so editing a BPM re-solves the section before the next
anchor instead of shifting everything after it.

Avoid:

- changing `Offset` (sync is baked into the tempo map; the field stays 0)
- moving or deleting BPM markers
- adding `delay` to `song.ini`

If the grid turns out to be wrong, fix it in rekordbox, re-analyze, and
reconvert with `--force`. Overwriting `notes.chart` discards placed notes, so
back the file up first if needed.

## Step 4: play it

Copy the folder into the Clone Hero songs directory, rescan songs in Clone
Hero, and test in practice mode at 100% speed.

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| track missing from `moongrid list` | not analyzed, or non-standard rekordbox install | analyze it in rekordbox, or pass `--anlz-dir` |
| `[no audio path — use --xml or --audio]` | Node < 22.5, or the file moved since analysis | `--xml collection.xml`, `--audio <file>`, or upgrade Node |
| `could not read rekordbox analysis registry` | rekordbox has the database locked | close rekordbox, or use `--xml` |
| `ffmpeg not found` | ffmpeg not installed or not on PATH | install it, or use `--chart-only` |
| `notes.chart already exists` | overwrite protection | back up placed notes, then `--force` |
| `intro is too short … for --no-pad` | the first beat arrives too soon for a lead-in tempo | drop `--no-pad` |
| chart drifts from the audio | the rekordbox grid is off | fix the grid in rekordbox (step 1), reconvert |
| BPM range in output looks jittery (e.g. 105–128 for a ~113 BPM song) | rekordbox stores beat times as whole milliseconds, so per-beat BPMs jitter | expected; beats still land within the reported precision |

## FAQ

**Is a rekordbox subscription required?** No. Analysis, dynamic beatgrids, and
XML export are available on the free plan.

**Does rekordbox 5 work?** Yes. Its analysis files parse, and the absolute
audio paths they store resolve when the files still exist at those locations.

**Non-4/4 songs?** No. rekordbox beatgrids are 4/4 only.

**Why is the audio longer than the original?** The lead-in silence. It keeps
`Offset` and `delay` at 0, which charting conventions require. `--no-pad`
leaves the audio untouched instead.

**Why re-encode the audio at all?** Some mp3s decode with a ~26 ms offset
difference between decoders, and rekordbox's beat times refer to its own
decode. Re-encoding to Ogg removes the ambiguity and lets the lead-in be baked
in.

**Other games or formats?** `.chart` only. The underlying beat data would also
suit MIDI tempo maps or osu! timing points; open an issue if you need one.
