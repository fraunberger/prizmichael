/**
 * DSP worker: owns the analyzed source (mono signal, pitch track, pitch marks)
 * and renders tracks on request, so the UI thread never blocks on audio math.
 */
import { mixToMono, trackPitch, PitchTrack } from '../dsp/pitch';
import { findPitchMarks, PitchMarks } from '../dsp/marks';
import { psola, voicingMask, gainAt } from '../dsp/psola';
import { correctionTarget } from '../dsp/tune';
import { renderHarmony } from '../dsp/harmony';
import { renderBass } from '../dsp/bass';
import { detectKey } from '../dsp/key';
import { deEss } from '../dsp/deess';
import { WorkerRequest, WorkerResponse } from './protocol';

interface Source {
  x: Float32Array;
  sampleRate: number;
  track: PitchTrack;
  marks: PitchMarks;
}

let source: Source | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'analyze') analyze(req);
    else if (req.type === 'render') render(req);
    else if (req.type === 'preview') preview(req);
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
};

function analyze(req: Extract<WorkerRequest, { type: 'analyze' }>) {
  const t0 = performance.now();
  const x = mixToMono(req.channels);
  post({ type: 'stage', id: req.id, stage: 'Listening for pitch' });
  const track = trackPitch(x, req.sampleRate);
  post({ type: 'stage', id: req.id, stage: 'Finding glottal pulses' });
  const marks = findPitchMarks(x, req.sampleRate, track);
  source = { x, sampleRate: req.sampleRate, track, marks };
  const key = detectKey(track);
  post({
    type: 'analyzed',
    id: req.id,
    result: {
      hop: track.hop,
      f0: new Float32Array(track.f0),
      confidence: new Float32Array(track.confidence),
      rms: new Float32Array(track.rms),
      key,
    },
    ms: performance.now() - t0,
  });
}

function render(req: Extract<WorkerRequest, { type: 'render' }>) {
  if (!source) throw new Error('Nothing analyzed yet');
  const t0 = performance.now();
  const { x, sampleRate, track, marks } = source;
  const p = req.params;
  const out: Extract<WorkerResponse, { type: 'rendered' }> = { type: 'rendered', id: req.id, ms: 0 };
  const transfer: Transferable[] = [];

  const target = correctionTarget(track, p.key, p.scale, p.retuneSpeed);

  if (req.parts.includes('corrected')) {
    post({ type: 'stage', id: req.id, stage: 'Tuning the lead' });
    const y = psola(x, sampleRate, marks, { hop: track.hop, hz: target });
    const mask = voicingMask(marks, track.f0.length, track.hop, sampleRate);
    const spf = track.hop * sampleRate;
    for (let i = 0; i < y.length; i++) {
      const m = gainAt(mask, i, spf);
      y[i] = m * y[i] + (1 - m) * x[i];
    }
    deEss(y, sampleRate, track);
    out.corrected = y;
    out.correctedHz = target;
    transfer.push(y.buffer, target.buffer);
  }

  if (req.parts.includes('harmony')) {
    post({ type: 'stage', id: req.id, stage: 'Singing the harmonies' });
    const [l, r] = renderHarmony(x, sampleRate, track, marks, p.notes, p.voicing);
    out.harmony = [l, r];
    transfer.push(l.buffer, r.buffer);
  }

  if (req.parts.includes('bass')) {
    post({ type: 'stage', id: req.id, stage: 'Dropping the bass' });
    const b = renderBass(x, sampleRate, track, marks, target, p.automation);
    out.bass = b;
    transfer.push(b.buffer);
  }

  out.ms = performance.now() - t0;
  post(out, transfer);
}

function preview(req: Extract<WorkerRequest, { type: 'preview' }>) {
  if (!source) return;
  const { x, sampleRate, track, marks } = source;
  const s0 = Math.max(0, Math.floor(req.start * sampleRate));
  const s1 = Math.min(x.length, Math.ceil(req.end * sampleRate));
  if (s1 <= s0) return;
  const [left, right] = renderHarmony(x, sampleRate, track, marks, req.notes, req.voicing, { start: s0, end: s1 });
  post({ type: 'previewed', id: req.id, start: s0 / sampleRate, harmony: [left, right] }, [left.buffer, right.buffer]);
}
