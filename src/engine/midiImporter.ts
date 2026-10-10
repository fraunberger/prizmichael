/**
 * MIDI file import using @tonejs/midi.
 * Converts standard MIDI file data into our MidiNote format.
 */
import { Midi } from '@tonejs/midi';
import { MidiNote, VOICE_COUNT, VoiceIndex, uid } from './types';

/**
 * Parse a .mid file into harmony notes. Multi-track files map one track per
 * voice (up to four). A single chordal track is split into voices by pitch:
 * the highest sounding note goes to voice I, the next to voice II, and so on.
 */
export async function importMidiFile(file: File): Promise<MidiNote[]> {
  const midi = new Midi(await file.arrayBuffer());
  const tracks = midi.tracks.filter(t => t.notes.length > 0);

  if (tracks.length > 1) {
    return tracks.slice(0, VOICE_COUNT).flatMap((track, i) =>
      track.notes.map(n => ({
        id: uid(),
        pitch: n.midi,
        startTime: n.time,
        duration: n.duration,
        voice: i as VoiceIndex,
      })),
    );
  }

  const notes = tracks[0]?.notes ?? [];
  const out: MidiNote[] = [];
  for (const n of notes) {
    // Rank among the notes sounding when this one starts
    const sounding = notes.filter(o => o.time <= n.time + 0.02 && o.time + o.duration > n.time + 0.02);
    const rank = sounding.filter(o => o.midi > n.midi).length;
    if (rank >= VOICE_COUNT) continue;
    out.push({ id: uid(), pitch: n.midi, startTime: n.time, duration: n.duration, voice: rank as VoiceIndex });
  }
  return out;
}
