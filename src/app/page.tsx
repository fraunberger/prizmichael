'use client';

import dynamic from 'next/dynamic';

// The studio is a browser instrument (Web Audio, workers, MIDI), so it renders
// only in the browser. That also leaves nothing for the browser to restore
// over server HTML before hydration (Firefox keeps buttons' disabled state
// across reloads, which caused hydration mismatches).
const App = dynamic(() => import('@/components/App'), { ssr: false });

export default function Home() {
  return <App />;
}
