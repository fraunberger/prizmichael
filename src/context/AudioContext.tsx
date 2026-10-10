'use client';

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AudioEngine } from '@/engine/AudioEngine';
import { EngineState, DEFAULT_ENGINE_STATE } from '@/engine/types';

interface AudioContextValue {
  engine: AudioEngine;
  state: EngineState;
}

const AudioCtx = createContext<AudioContextValue | null>(null);

const serverSnapshot = () => DEFAULT_ENGINE_STATE;

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [engine] = useState(() => new AudioEngine());
  const state = useSyncExternalStore(engine.subscribe, engine.getState, serverSnapshot);

  useEffect(() => () => engine.dispose(), [engine]);

  return (
    <AudioCtx.Provider value={{ engine, state }}>
      {children}
    </AudioCtx.Provider>
  );
}

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error('useAudio must be used within AudioProvider');
  return ctx;
}
