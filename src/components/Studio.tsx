'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAudio } from '@/context/AudioContext';
import { useStudio } from '@/context/StudioContext';
import { useHarmonyActions } from '@/hooks/useHarmonyActions';
import { useMidiKeyboard } from '@/hooks/useMidiKeyboard';
import { importMidiFile } from '@/engine/midiImporter';
import { Intensity, VoiceIndex } from '@/engine/types';
import TopBar, { DEMO_NAME, DEMO_URL } from './TopBar';
import InstrumentPanel from './InstrumentPanel';
import HarmonyToolbar from './HarmonyToolbar';
import { CHORD_KEYS } from '@/lib/chordKeys';
import LiveToolbar from './LiveToolbar';
import MixerPanel from './MixerPanel';
import Overview from './timeline/Overview';
import Ruler from './timeline/Ruler';
import ChordLane from './timeline/ChordLane';
import PianoRoll from './timeline/PianoRoll';
import AutomationLane from './timeline/AutomationLane';
import PrismMark from './ui/PrismMark';

export default function Studio() {
  const { state } = useAudio();
  const { mode } = useStudio();
  const live = mode === 'live';
  const dragging = useFileDrop();
  const midi = useMidiKeyboard();
  useShortcuts();

  const showEmpty = !state.audioBuffer && (state.status === 'idle' || state.status === 'error');
  const showBusy = state.status === 'loading' || state.status === 'analyzing';

  return (
    <div className="flex flex-col h-screen min-w-[1080px]">
      <TopBar midi={midi} />
      <InstrumentPanel />
      <div className="flex flex-1 min-h-0">
        <main className="relative flex flex-col flex-1 min-w-0">
          <Overview />
          {live ? <LiveToolbar /> : <HarmonyToolbar />}
          <Ruler />
          {!live && <ChordLane />}
          <PianoRoll />
          {!live && <AutomationLane />}
          {showEmpty && <EmptyState />}
          {showBusy && <BusyState />}
        </main>
        <MixerPanel />
      </div>
      <Footer live={live} />
      {dragging && (
        <div className="fixed inset-3 z-50 rounded-[18px] border-2 border-dashed border-ink-3 bg-paper/80 grid place-items-center pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <PrismMark size={44} />
            <span className="font-display text-[20px] tracking-[0.06em]">Drop a vocal, or a MIDI file of chords</span>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  const { engine, state } = useAudio();
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-paper">
      <div className="flex flex-col items-center text-center max-w-[560px] px-6">
        <PrismMark size={58} />
        <h1 className="mt-6 font-display text-[30px] leading-tight tracking-[0.03em] text-ink">Sing one voice. Hear a choir.</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          Prizmichael tunes a lead vocal and grows harmonies out of it. Each voice locks to the chords you play,
          the way Bon Iver&rsquo;s Messina does.
        </p>
        {state.status === 'error' && (
          <p className="mt-3 font-type text-[12px] text-accent">{state.error}</p>
        )}
        <div className="mt-7 flex gap-2">
          <button className="btn btn-ink h-9 px-4 text-[13px]" onClick={() => void engine.loadAudioUrl(DEMO_URL, DEMO_NAME)}>
            Try the demo
          </button>
          <label className="btn h-9 px-4 text-[13px] cursor-pointer">
            Open a vocal
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void engine.loadAudioFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="mt-3 font-type text-[11px] text-ink-3">demo: Hozier, &ldquo;The Humours of Whiskey&rdquo; (a cappella)</p>
        <ol className="mt-9 grid grid-cols-3 gap-5 text-left">
          {[
            ['∆', 'Hear', 'We track the melody, find its key, and tune it.'],
            ['Σ', 'Play', 'Hold chords on A–J while it plays. Every pass is kept as a take.'],
            ['✦', 'Push', '1–4 takes it from clean to falling apart.'],
          ].map(([g, t, d]) => (
            <li key={t} className="flex flex-col gap-1.5">
              <span className="font-type text-[15px] text-ink-2">{g}</span>
              <span className="label text-ink-2">{t}</span>
              <span className="text-[12.5px] leading-snug text-ink-3">{d}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function BusyState() {
  const { state } = useAudio();
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-paper/85 backdrop-blur-[1px]">
      <div className="flex flex-col items-center gap-4">
        <PrismMark size={46} animated />
        <span className="font-type text-[13px] text-ink-2">
          {state.status === 'loading' ? 'opening the file…' : `${(state.renderStage || 'listening').toLowerCase()}…`}
        </span>
      </div>
    </div>
  );
}

function Footer({ live }: { live: boolean }) {
  const items: [string, string][] = live
    ? [
        ['space', 'play'],
        ['A–J', 'hold to sing chords I–VII'],
        ['↑ ↓', 'octave'],
        ['1–4', 'intensity'],
        ['L', 'loop'],
        ['click', 'jump there'],
        ['⌘ scroll', 'zoom'],
      ]
    : [
        ['space', 'play'],
        ['A–J', 'fill the region (hold while playing to hear)'],
        ['L', 'loop'],
        ['1–4', 'voice'],
        ['drag', 'draw a note'],
        ['⇧ click', 'split'],
        ['⌘Z', 'undo'],
        ['⌘ scroll', 'zoom'],
      ];
  return (
    <footer className="flex items-center gap-4 h-7 px-4 border-t border-rule bg-paper-2 overflow-hidden whitespace-nowrap">
      {items.map(([k, v]) => (
        <span key={k} className="font-type text-[10.5px] text-ink-3">
          <kbd className="font-type text-ink-2">{k}</kbd> {v}
        </span>
      ))}
    </footer>
  );
}

/** Files dropped anywhere: audio loads a new take, MIDI adds notes. */
function useFileDrop(): boolean {
  const { engine } = useAudio();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setDragging(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      if (/\.midi?$/i.test(file.name)) {
        const notes = await importMidiFile(file);
        engine.setMidiNotes([...engine.getState().midiNotes, ...notes]);
      } else {
        void engine.loadAudioFile(file);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [engine]);
  return dragging;
}

/** Global keyboard: transport, chords on the white-key row, note editing. */
function useShortcuts(): void {
  const { engine, state } = useAudio();
  const studio = useStudio();
  const actions = useHarmonyActions();
  const held = useRef<string | null>(null);

  const latest = useRef({ state, studio, actions });
  useEffect(() => { latest.current = { state, studio, actions }; });

  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const release = () => {
      if (held.current) {
        held.current = null;
        latest.current.actions.liveChordUp();
      }
    };

    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const { state: s, studio: st, actions: a } = latest.current;
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (mod) {
        if (key === 'z') { e.preventDefault(); if (e.shiftKey) engine.redo(); else engine.undo(); }
        else if (key === 'y') { e.preventDefault(); engine.redo(); }
        else if (key === 'a' && s.midiNotes.length) { e.preventDefault(); a.selectAll(); }
        return;
      }
      if (!s.audioBuffer) return;

      const chord = CHORD_KEYS.indexOf(key);
      if (chord >= 0 && !e.altKey) {
        e.preventDefault();
        if (e.repeat) return;
        if (s.playing) {
          // Straight to the new chord: the engine crossfades, no gap
          held.current = key;
          a.liveChordDown(chord);
        } else if (st.mode === 'live') {
          // In live mode a chord starts the track
          release();
          held.current = key;
          void engine.play().then(() => {
            if (held.current === key) latest.current.actions.liveChordDown(chord);
          });
        } else {
          a.fillChord(chord);
        }
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          engine.togglePlay();
          break;
        case 'Enter':
          if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
          engine.stop();
          break;
        case 'l':
        case 'L': {
          if (s.loop) engine.setLoop(null);
          else {
            const r = st.region ?? [st.view.start, st.view.end];
            engine.setLoop({ start: r[0], end: r[1] });
          }
          break;
        }
        case '1': case '2': case '3': case '4': {
          if (st.mode === 'live') {
            engine.setIntensity(Number(e.key) as Intensity);
            break;
          }
          const v = (Number(e.key) - 1) as VoiceIndex;
          st.setActiveVoice(v);
          a.revoiceSelected(v);
          break;
        }
        case 'Backspace':
        case 'Delete':
          if (st.selected.size) { e.preventDefault(); a.deleteSelected(); }
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          if (st.mode === 'live') {
            // The chord row moves by octaves
            e.preventDefault();
            if (!e.repeat) a.changeOctave(e.key === 'ArrowUp' ? 1 : -1);
          } else if (st.selected.size) {
            e.preventDefault();
            a.transposeSelected((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
          }
          break;
        case 'Escape':
          engine.stopAudition();
          st.setSelected(new Set());
          st.setRegion(null);
          break;
        case '=':
        case '+':
          st.zoom(0.7, engine.getPlaybackTime());
          break;
        case '-':
        case '_':
          st.zoom(1.45, engine.getPlaybackTime());
          break;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (held.current && e.key.toLowerCase() === held.current) release();
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [engine]);
}
