'use client';

import { useEffect, useRef, useState } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { useHarmonyActions } from './useHarmonyActions';

export type MidiStatus = 'off' | 'connecting' | 'on' | 'no-devices' | 'unsupported' | 'denied';

export interface MidiKeyboard {
  status: MidiStatus;
  device: string | null;
  connect: () => void;
  disconnect: () => void;
}

const CHORD_SETTLE_MS = 30; // fingers never land at exactly the same time

/**
 * Play the harmonizer from a MIDI keyboard, like the Messina. While the track
 * plays, held notes become the voices (highest note = voice I, up to four).
 * While paused, a chord played and released is written into the region.
 */
export function useMidiKeyboard(): MidiKeyboard {
  const { state } = useAudio();
  const studio = useStudio();
  const actions = useHarmonyActions();
  const [status, setStatus] = useState<MidiStatus>('off');
  const [device, setDevice] = useState<string | null>(null);
  const access = useRef<MIDIAccess | null>(null);

  const latest = useRef({ state, studio, actions });
  useEffect(() => { latest.current = { state, studio, actions }; });

  const held = useRef(new Set<number>());
  const captured = useRef(new Set<number>());
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sounding = useRef(false);

  const applyHeld = () => {
    settle.current = null;
    const { state: s, actions: a } = latest.current;
    if (!s.playing) return;
    if (sounding.current) a.liveChordUp();
    sounding.current = held.current.size > 0;
    if (sounding.current) a.liveNotesDown([...held.current]);
  };

  const onMessage = (e: MIDIMessageEvent) => {
    const data = e.data;
    if (!data || data.length < 3) return;
    const cmd = data[0] & 0xf0;
    const note = data[1];
    const on = cmd === 0x90 && data[2] > 0;
    const off = cmd === 0x80 || (cmd === 0x90 && data[2] === 0);
    if (!on && !off) return;
    if (on) {
      held.current.add(note);
      captured.current.add(note);
    } else {
      held.current.delete(note);
    }
    const { state: s, actions: a } = latest.current;
    if (s.playing) {
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(applyHeld, CHORD_SETTLE_MS);
    } else if (held.current.size === 0 && captured.current.size > 0) {
      a.fillNotes([...captured.current]);
      captured.current.clear();
    }
  };

  const attach = (midi: MIDIAccess) => {
    const names: string[] = [];
    midi.inputs.forEach(input => {
      input.onmidimessage = onMessage;
      names.push(input.name ?? 'MIDI input');
    });
    setDevice(names[0] ?? null);
    setStatus(names.length ? 'on' : 'no-devices');
  };

  const connect = () => {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      setStatus('unsupported');
      return;
    }
    setStatus('connecting');
    navigator.requestMIDIAccess().then(
      midi => {
        access.current = midi;
        attach(midi);
        midi.onstatechange = () => attach(midi);
      },
      () => setStatus('denied'),
    );
  };

  const disconnect = () => {
    const midi = access.current;
    if (midi) {
      midi.inputs.forEach(input => { input.onmidimessage = null; });
      midi.onstatechange = null;
    }
    access.current = null;
    held.current.clear();
    captured.current.clear();
    if (sounding.current) latest.current.actions.liveChordUp();
    sounding.current = false;
    setStatus('off');
    setDevice(null);
  };

  // Pausing ends whatever was being held
  useEffect(() => {
    if (!state.playing) sounding.current = false;
  }, [state.playing]);

  useEffect(() => () => {
    const midi = access.current;
    if (midi) midi.inputs.forEach(input => { input.onmidimessage = null; });
  }, []);

  return { status, device, connect, disconnect };
}
