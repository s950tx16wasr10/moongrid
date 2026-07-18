# The moongrid guide

moongrid takes the tempo analysis rekordbox already does brilliantly — including
dynamic beatgrids that follow a live drummer beat by beat — and turns it into a
Clone Hero song folder whose `.chart` tempo map is locked to the audio. You open
the result in Moonscraper Chart Editor and only place notes. No tapping out BPMs,
no offset fiddling.

The flow is: **rekordbox analyzes → moongrid converts → Moonscraper charts →
Clone Hero plays.**

## What you need

| thing | why | notes |
|---|---|---|
| [rekordbox](https://rekordbox.com) 5/6/7 | does the tempo analysis | the **free plan is enough** — no subscription needed for analysis or XML export |
| [Node.js](https://nodejs.org) 18+ | runs moongrid | 22.5+ recommended: enables automatic audio-file lookup |
| [ffmpeg](https://ffmpeg.org) | packages the audio | `winget install ffmpeg` / `brew install ffmpeg`; skippable with `--chart-only` |
| [Moonscraper Chart Editor](https://github.com/FireFox2000000/Moonscraper-Chart-Editor) | note authoring | |
| [Clone Hero](https://clonehero.net) | playing the result | |

Install moongrid:

```
npm install -g moongrid
```

## Step 1 — Get the beatgrid right in rekordbox

The chart can only be as good as rekordbox's grid, so this step is where the
quality happens.

1. **Import the song**: drag the audio file into rekordbox's collection. It
   analyzes automatically.
2. **Use Dynamic analysis for variable-tempo music** (live drummers, old
   recordings, anything not made on a computer):
   *Preferences → Analysis → Track Analysis Mode → **Dynamic***, then right-click
   the track → *Analyze Track* to re-analyze. For electronic/quantized music the
   default Normal mode is fine (you'll get one clean BPM).
3. **Audition the grid**: load the track onto a deck and check that the beat
   markers sit on the beats — intro, middle, and outro. rekordbox's grid-edit
   mode has a metronome click for exactly this.
4. **Fix it if it's off**: use rekordbox's GRID panel (nudge, shift, tap) until
   it's right. Whatever the grid says is what your chart will say.

## Step 2 — Convert

See what's analyzed and convertible:

```
moongrid list
```

Convert (matches by title/filename, case-insensitive):

```
moongrid convert venus
```

You get a song folder with `notes.chart` (tempo map, no notes yet), `song.ogg`
(your audio with the lead-in baked in), and `song.ini`. The output tells you
what happened — the important line is `precision:`, the worst difference between
the chart's beat times and rekordbox's, across every beat. It is typically well
under 0.1 ms. moongrid refuses to write a chart worse than 2 ms.

**Recipes:**

```
# with title/artist/album metadata (and audio lookup on older Node):
#   in rekordbox: File > Export Collection in xml format
moongrid convert venus --xml collection.xml

# metadata by hand instead:
moongrid convert venus --artist "Television" --album "Marquee Moon" --year 1977

# from a USB stick exported by rekordbox (audio resolves from the stick):
moongrid convert "my track" --anlz-dir E:\PIONEER\USBANLZ

# rekordbox doesn't know where the audio is? point at it:
moongrid convert venus --audio "D:\Music\Venus.flac"

# chart only, no audio processing (no ffmpeg needed):
moongrid convert venus --chart-only

# keep the audio file untouched (needs a long-enough intro before beat 1):
moongrid convert venus --no-pad
```

Re-running a conversion into the same folder needs `--force` — moongrid never
overwrites a `notes.chart` on its own, because that file is where your charted
notes live.

## Step 3 — Chart in Moonscraper

Open `notes.chart` in Moonscraper. Before placing anything:

- **Turn on the metronome** and spot-check the sync at the intro, somewhere in
  the middle, and the outro. It should click dead-on everywhere.

What you'll see in the tempo lane:

- **Lots of BPM markers** for dynamically-analyzed songs — one per real tempo
  change, sometimes one per beat. That's the point of moongrid: this is the
  tempo map you didn't have to make. Leave it alone.
- **Anchors**: the BPM markers are anchored to absolute audio times. If you edit
  a BPM somewhere, everything after the next anchor stays in sync instead of
  sliding — that's Moonscraper's anchor feature doing its job.

Three don'ts, one do:

- Don't change **Offset** (it's 0 by design; sync is baked into the map).
- Don't move or delete BPM markers to "clean up" the map.
- Don't add `delay` in song.ini.
- Do just place notes, and save.

If the grid turns out to be wrong somewhere, fix it **in rekordbox**, re-analyze,
and re-convert with `--force` into a fresh folder (or accept losing placed notes
in that file — `--force` overwrites `notes.chart`).

## Step 4 — Play it

Copy the folder into your Clone Hero songs directory, rescan songs in CH, and
test in **practice mode** at 100% speed. Done.

## Troubleshooting

| symptom | likely cause | fix |
|---|---|---|
| track missing from `moongrid list` | not analyzed, or non-standard rekordbox install | analyze it in rekordbox; or pass `--anlz-dir` |
| `[no audio path — use --xml or --audio]` | Node < 22.5, or the file moved since analysis | `--xml collection.xml`, `--audio <file>`, or upgrade Node |
| `could not read rekordbox analysis registry` | rekordbox has the DB locked | close rekordbox, or use `--xml` |
| `ffmpeg not found` | ffmpeg not installed / not on PATH | install it, or `--chart-only` |
| `notes.chart already exists` | overwrite protection | back up your notes, then `--force` |
| `intro is too short … for --no-pad` | the song starts almost immediately | drop `--no-pad` and let moongrid pad the audio |
| chart drifts from the audio | the rekordbox grid is off | fix the grid in rekordbox (step 1), reconvert |
| BPM range in output looks jittery (e.g. 105–128 for a ~113 song) | rekordbox stores beat times in whole milliseconds; per-beat BPMs jitter around the truth | normal — every beat still lands within a fraction of a millisecond |

## FAQ

**Do I need a rekordbox subscription?** No. Analysis, dynamic beatgrids, and XML
export all work on the free plan.

**Does it work with rekordbox 5?** Yes — the analysis files parse fine; audio
lookup needs `--xml` or `--audio` on very old libraries.

**Non-4/4 songs?** No. rekordbox beatgrids are inherently 4/4; odd meters need a
different source of truth.

**Why is the audio ~2 seconds longer than the original?** That's the lead-in
silence, baked in so the chart needs no offset (charting conventions want
`Offset`/`delay` at 0). Use `--no-pad` to keep the audio untouched instead.

**Why re-encode the audio at all?** Some mp3s decode with a ~26 ms difference
between decoders, and rekordbox's beat times refer to *its* decode. Re-encoding
to Ogg pins the timing down. (It also lets the pad be baked in.)

**Other games / formats?** `.chart` only for now. The underlying beat data would
suit MIDI tempo maps or osu! timing points — open an issue if you want one.
