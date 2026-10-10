'use client';

import { AudioProvider } from '@/context/AudioContext';
import { StudioProvider } from '@/context/StudioContext';
import Studio from '@/components/Studio';

export default function Home() {
  return (
    <AudioProvider>
      <StudioProvider>
        <Studio />
      </StudioProvider>
    </AudioProvider>
  );
}
