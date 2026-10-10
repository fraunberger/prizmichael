/**
 * The mix bus: per-track tone, a lush synthetic hall, tape-style warmth, glue
 * compression and a safety limiter. The same graph is built on the live
 * AudioContext and on an OfflineAudioContext for export, so what you hear is
 * what you get.
 *
 *   dry ┐
 *  lead ┴─ lead bus (HPF, de-harsh, air, comp) ─┐
 * voices ── voice bus (HPF, darker top, comp) ──┼─ sum ─ warmth ─ glue ─ limiter ─ out
 *  bass ── bass bus (low shelf) ────────────────┤
 *                 sends ── pre-delay ─ hall ────┘
 */
import { FxParams, MixerState, TrackName } from './types';

export const TRACK_NAMES: TrackName[] = ['dry', 'corrected', 'harmony', 'bass'];

const REVERB_SEND = { lead: 0.22, voices: 0.6, bass: 0.03 };

export interface MixGraph {
  inputs: Record<TrackName, GainNode>;
  meters: Record<TrackName | 'master', AnalyserNode>;
  output: AudioNode;
  setMixer(mixer: MixerState): void;
  setFx(fx: FxParams): void;
}

export function trackGain(mixer: MixerState, name: TrackName): number {
  if (mixer.mute[name]) return 0;
  if (mixer.solo !== null && mixer.solo !== name) return 0;
  return mixer[name];
}

export function createMixGraph(ctx: BaseAudioContext, mixer: MixerState, fx: FxParams): MixGraph {
  const live = typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;
  const set = (param: AudioParam, value: number) => {
    if (live) param.setTargetAtTime(value, ctx.currentTime, 0.03);
    else param.value = value;
  };

  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const biquad = (type: BiquadFilterType, freq: number, q = 0.707, db = 0) => {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q; f.gain.value = db;
    return f;
  };
  const compressor = (threshold: number, ratio: number, attack: number, release: number, knee: number) => {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = threshold; c.ratio.value = ratio;
    c.attack.value = attack; c.release.value = release; c.knee.value = knee;
    return c;
  };
  const chain = (...nodes: AudioNode[]) => {
    for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  };
  const meter = () => {
    const a = ctx.createAnalyser();
    a.fftSize = 1024;
    a.smoothingTimeConstant = 0;
    return a;
  };

  const inputs = {
    dry: gain(trackGain(mixer, 'dry')),
    corrected: gain(trackGain(mixer, 'corrected')),
    harmony: gain(trackGain(mixer, 'harmony')),
    bass: gain(trackGain(mixer, 'bass')),
  };
  const meters = { dry: meter(), corrected: meter(), harmony: meter(), bass: meter(), master: meter() };
  for (const name of TRACK_NAMES) inputs[name].connect(meters[name]);

  const sum = gain();
  const reverbIn = gain();

  // Lead: clean up rumble, smooth the 3 kHz edge, open the top, even it out
  const leadIn = gain();
  inputs.dry.connect(leadIn);
  inputs.corrected.connect(leadIn);
  const leadOut = chain(
    leadIn,
    biquad('highpass', 75),
    biquad('peaking', 3200, 1.1, -2),
    biquad('highshelf', 11000, 0.707, 2),
    compressor(-22, 2.5, 0.008, 0.16, 12),
  );

  // Voices: lighter low end and a darker top so they sit behind the lead
  const voicesOut = chain(
    inputs.harmony,
    biquad('highpass', 160),
    biquad('highshelf', 6500, 0.707, -3.5),
    compressor(-24, 2, 0.015, 0.25, 12),
  );

  const bassOut = chain(inputs.bass, biquad('lowshelf', 90, 0.707, 2));

  leadOut.connect(sum);
  voicesOut.connect(sum);
  bassOut.connect(sum);
  leadOut.connect(gain(REVERB_SEND.lead)).connect(reverbIn);
  voicesOut.connect(gain(REVERB_SEND.voices)).connect(reverbIn);
  bassOut.connect(gain(REVERB_SEND.bass)).connect(reverbIn);

  // Hall: pre-delay keeps the voice up front; the tail is long and dark
  const preDelay = ctx.createDelay(0.2);
  preDelay.delayTime.value = 0.028;
  const convolver = ctx.createConvolver();
  convolver.buffer = makeHall(ctx, 3.4);
  const reverbReturn = gain(fx.space * 1.4);
  // Band-limit what feeds the hall so sibilants and rumble never splash
  chain(reverbIn, preDelay, biquad('highpass', 220), biquad('lowpass', 7000), convolver, reverbReturn, sum);

  // Warmth: drive into an asymmetric soft clip, plus a body/smooth tilt
  const drive = gain(1 + fx.warmth * 2.5);
  const shaper = ctx.createWaveShaper();
  shaper.curve = saturationCurve();
  shaper.oversample = '4x';
  const makeup = gain(1 / (1 + fx.warmth * 1.2));
  const body = biquad('lowshelf', 220, 0.707, fx.warmth * 2.5);
  const smooth = biquad('highshelf', 9000, 0.707, -fx.warmth * 2.5);

  const out = chain(
    sum, drive, shaper, makeup, body, smooth,
    compressor(-16, 2, 0.025, 0.25, 10),
    compressor(-2, 20, 0.002, 0.08, 0),
    gain(0.92),
  );
  out.connect(meters.master);

  return {
    inputs,
    meters,
    output: out,
    setMixer(m) {
      for (const name of TRACK_NAMES) set(inputs[name].gain, trackGain(m, name));
    },
    setFx(f) {
      set(reverbReturn.gain, f.space * 1.4);
      set(drive.gain, 1 + f.warmth * 2.5);
      set(makeup.gain, 1 / (1 + f.warmth * 1.2));
      set(body.gain, f.warmth * 2.5);
      set(smooth.gain, -f.warmth * 2.5);
    },
  };
}

/** Gentle, slightly asymmetric tanh curve: even harmonics, no hard edge. */
function saturationCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const bias = 0.12;
  const norm = Math.tanh(1 + bias) - Math.tanh(bias);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = (Math.tanh(x + bias) - Math.tanh(bias)) / norm;
  }
  return curve;
}

/**
 * Synthetic hall impulse: decorrelated noise per channel with an exponential
 * decay and a lowpass that closes over time (air absorbs highs first), plus a
 * scatter of early reflections. Seeded so every render sounds the same.
 */
function makeHall(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) / 4294967296) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-6.9 * t / seconds);
      const cutoff = 1100 + 8500 * Math.exp(-t * 1.8);
      const a = Math.exp(-2 * Math.PI * cutoff / sr);
      lp = a * lp + (1 - a) * rand();
      const fadeIn = Math.min(1, t / 0.006);
      data[i] = lp * env * fadeIn;
    }
    // Early reflections in the first 70 ms
    for (let r = 0; r < 14; r++) {
      const at = Math.floor((0.006 + Math.abs(rand()) * 0.065) * sr);
      data[at] += rand() * 0.5 * Math.exp(-at / sr / 0.05);
    }
    let energy = 0;
    for (let i = 0; i < len; i++) energy += data[i] * data[i];
    const norm = 1 / Math.sqrt(energy / sr * 4 + 1e-9);
    for (let i = 0; i < len; i++) data[i] *= norm;
  }
  return buf;
}
