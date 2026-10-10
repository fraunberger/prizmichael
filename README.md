# Prizmiker

Sing one voice, hear a choir. Prizmiker tunes a lead vocal and grows up to four
harmony voices out of it, each locked to the chords you play. It's modeled on
Bon Iver's **Messina**: Chris Messina's rig of Ableton, two Auto-Tunes and an
Eventide H8000 that Justin Vernon plays from a keyboard, and on Francis and the
Lights' **Prismizer** sound.

```bash
npm run dev   # http://localhost:3000, then "Try the demo"
```

## Playing it

| | |
|---|---|
| `space` | play / pause |
| `A S D F G H J` | chords I–VII of the song's key (the "white keys"). Hold while playing to sing them live over the track; while paused, fills the selected region |
| `R` | arm recording: chords you play live are written into the piano roll |
| `L` | loop the selected region (or what's on screen); drag on the ruler to set a loop |
| `1`–`4` | voice to draw with (also moves selected notes to that voice) |
| drag in the piano roll | draw a note · drag a note to move · drag its right edge to resize · alt-drag to duplicate · right-click to delete |
| `shift`-click / double-click the Chords lane | split the song into regions |
| `⌘Z` / `⇧⌘Z` | undo / redo |
| `⌘`-scroll, `+` / `−` | zoom the timeline |

A MIDI keyboard works too (the keys button in the transport, Chrome/Edge):
hold notes while the track plays and the voices sing exactly those notes, with
the highest note on voice I.

## The sound

- **Tune** (∆): lead pitch correction. Retune speed smooths the *correction*,
  like Auto-Tune, so hard settings give the robotic snap and slow ones keep
  vibrato. The key is detected automatically (Krumhansl–Kessler), compensating
  for singers who sit sharp or flat overall.
- **Voices** (Σ): every voice is pitch-locked to its notes (not shifted in
  parallel), which is what makes a held chord sound like a choir holding it.
  *Glide* is portamento between connected notes. *Humanize* adds per-voice
  detune, slow drift, late entrances and a different "throat" per voice (the
  Messina's randomness). *Double* adds a second take of each voice, panned
  opposite, the main source of width. *Throat* shifts formants. On top of that,
  voices automatically get brighter as they go up and darker as they go down.
- **Space** (∞): a long, dark synthetic hall and tape-style warmth on the mix
  bus. The lead bus is de-harshed and gently compressed, and the voices sit
  behind it with a softer top. Export renders through the same graph, so
  what you hear is what you get.

## How it works

```
src/engine/
  dsp/pitch.ts     YIN candidates on a decimated signal + Viterbi tracking (no octave jumps)
  dsp/marks.ts     one pitch mark per glottal pulse, chosen jointly by dynamic programming
  dsp/psola.ts     time-varying TD-PSOLA: exact target pitch, independent formant shift
  dsp/tune.ts      Auto-Tune-style correction curve with hysteresis
  dsp/harmony.ts   Messina-style voices: glide, throat, humanize, doubles, panning
  dsp/bass.ts      the lead an octave down plus a sine sub, with a drive envelope
  dsp/deess.ts     split-band de-esser for the tuned lead
  dsp/key.ts       key + tuning offset detection
  worker/          analysis and rendering run off the main thread
  fx.ts            Web Audio mix bus (live and offline/export)
  chords.ts        diatonic chords, voicings around the melody, auto-harmonize
  AudioEngine.ts   transport, background re-rendering, live chords, undo
```

Every edit marks the affected tracks dirty and a debounced background render
follows (a 51-second take renders in about 0.2 s), so changes are heard almost
immediately, even mid-playback. Live chords are rendered in 1.6-second windows
just ahead of the playhead on a second worker, so a chord sounds within about 60 ms of the key going down.
