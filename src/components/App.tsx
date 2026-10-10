'use client';

import { AudioProvider } from '@/context/AudioContext';
import { StudioProvider } from '@/context/StudioContext';
import Studio from './Studio';

export default function App() {
  return (
    <AudioProvider>
      <StudioProvider>
        <Studio />
      </StudioProvider>
    </AudioProvider>
  );
}
