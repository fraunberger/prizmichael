# Prizmichael

Sing one voice, hear a choir. Prizmichael tunes a lead vocal and grows up to four
harmony voices out of it, each locked to the chords you play. It's modeled on
Bon Iver's **Messina**: Chris Messina's rig of Ableton, two Auto-Tunes and an
Eventide H8000 that Justin Vernon plays from a keyboard, and on Francis and the
Lights' **Prismizer** sound.

```bash
npm run dev   # http://localhost:3000, then "Try the demo"
```

It also lives on [birdpile](https://github.com/fraunberger/birdpile) as the
northern mockingbird. `npm run export:birdpile` builds a static copy served
under `/prizmichael` into `../birdpile/public/prizmichael`; commit it there to update
the bird.

## Playing it

Prizmichael has two sides, switched at the top: **Live** for playing chords over
the track, and **Prepare** for writing harmony notes by hand.

### Live

| | |
|---|---|
| `A S D F G H J` | hold to sing chords I–VII of the song's key (the "white keys") over the track. Pressing one while stopped starts the track. The pads under the waveform work the same with a mouse |
| `↑` / `↓` | move the chord row up or down an octave (shown in the Octave stepper next to the pads, ±2). A chord you're holding jumps with it |
| `1`–`4` | intensity: clean, bloom, wild, insane |
| `space` | play / pause (also stops listening to a take) |
| `L` | loop what's on screen; drag on the ruler to set a loop |
| click the piano roll | jump there |

Every pass you play chords over (play to pause, or once around the loop) is
kept as a **take**, listed under the mixer. A take starts the moment you play
its first chord and is the master output exactly as you heard it, reverb tail
included. Listen back, save it as WAV, discard it, or send its chords to
Prepare (the pencil) to edit them.

**Intensity** turns several knobs at once, and you can watch them move: hard
retune, longer glide, more humanize and doubling, more glitch, more vary, more
bass drive. Any knob, or a whole section, can be **locked** (hover it for the
lock) so intensity leaves it alone. Space and Warmth start locked.

A MIDI keyboard works too (the keys button in the transport, Chrome/Edge):
hold notes and the voices sing exactly those notes, with the highest note on
voice I. In Live, a note starts the track if it's stopped.

### Prepare

| | |
|---|---|
| `A S D F G H J` | fill the selected region (or the one under the playhead) with chords I–VII; hold while playing to hear them |
| `1`–`4` | voice to draw with (also moves selected notes to that voice) |
| drag in the piano roll | draw a note · drag a note to move · drag its right edge to resize · alt-drag to duplicate · right-click to delete |
| `shift`-click / double-click the Chords lane | split the song into regions |
| Auto-harmonize | write harmony lines that follow the melody |
| `⌘Z` / `⇧⌘Z` | undo / redo |
| `⌘`-scroll, `+` / `−` | zoom the timeline |

Prepared notes also play in Live; they duck out while you hold a chord.

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
  opposite, the main source of width. *Throat* shifts formants. *Vary*
  re-voices part of a live chord every time you hit it (one note at bloom, all
  of them at insane), so the same chord comes out different. *Glitch* is the
  Prismizer coming apart: octave and fifth leaps that snap instead of gliding,
  sudden throat flips, stutters and chops, each voice on its own dice. On top
  of that, voices automatically get brighter as they go up and darker as they
  go down.
- **Space** (∞): a long, dark synthetic hall and tape-style warmth on the mix
  bus. The lead bus is de-harshed and gently compressed, and the voices sit
  behind it with a softer top. Export renders through the same graph, so
  what you hear is what you get.
- **Bass** (◊): the lead an octave down plus a sine sub. *Drive* is a live fuzz:
  warm low on the dial, then an octave-up rectifier and a hard, lopsided clip.
  The Drive lane in Prepare adds to it over time. In Live, the bass rides with
  the chords like the voices do: *Gate* sets how far it drops while no chord
  sings (−27 dB by default; all the way up, it only plays with the chords).

## How it works

```
src/engine/
  dsp/pitch.ts     YIN candidates on a decimated signal + Viterbi tracking (no octave jumps)
  dsp/marks.ts     one pitch mark per glottal pulse, chosen jointly by dynamic programming
  dsp/psola.ts     time-varying TD-PSOLA: exact target pitch, independent formant shift
  dsp/tune.ts      Auto-Tune-style correction curve with hysteresis
  dsp/harmony.ts   Messina-style voices: glide, throat, humanize, doubles, panning
  dsp/glitch.ts    leaps, throat flips and stutters, decided per time slot
  dsp/bass.ts      the lead an octave down plus a sine sub, with a drive envelope
  dsp/deess.ts     split-band de-esser for the tuned lead
  dsp/key.ts       key + tuning offset detection
  worker/          analysis and rendering run off the main thread
  fx.ts            Web Audio mix bus (live and offline/export)
  chords.ts        diatonic chords, voicings around the melody, vary, auto-harmonize
  recorder.ts      AudioWorklet tap on the master output, for takes
  AudioEngine.ts   transport, background re-rendering, live chords, intensity, takes, undo
```

Every edit marks the affected tracks dirty and a debounced background render
follows (a 51-second take renders in about 0.2 s), so changes are heard almost
immediately, even mid-playback. Live chords are rendered in 1.6-second windows
just ahead of the playhead on a second worker, so a chord sounds within about 60 ms of the key going down.
Turning a knob (or changing intensity) while a chord is held re-renders it from
the playhead, so the change is heard right away.
