/**
 * AudioEngine: owns the AudioContext, the mix graph and the DSP worker.
 *
 * Analysis and rendering run in a worker, and rendering is automatic: any edit
 * marks the affected tracks dirty and a debounced render follows. Fresh tracks
 * are crossfaded in under the playhead, so edits can be heard mid-playback.
 * The mix (faders, mute/solo, space, warmth, bass drive) is live Web Audio
 * and costs nothing to change.
 *
 * In live mode every pass over the track is a session: the master output is
 * recorded, and each pass (a loop iteration, or play to pause) in which chords
 * were played becomes a take.
 */
import {
  AutomationPoint,
  CorrectedPitchFrame,
  DEFAULT_ENGINE_STATE,
  EngineState,
  FxParams,
  INTENSITY,
  Intensity,
  KnobId,
  gateFloor,
  LoopRegion,
  MidiNote,
  MixerState,
  NoteName,
  PitchContour,
  ScaleType,
  Take,
  TrackName,
  VoiceIndex,
  VoicingParams,
  uid,
} from './types';
import { createMixGraph, MixGraph, TRACK_NAMES } from './fx';
import { MasterRecorder } from './recorder';
import { RenderPart, WorkerRequest, WorkerResponse } from './worker/protocol';
import toWav from 'audiobuffer-to-wav';

export type EngineListener = (state: EngineState) => void;

interface Snapshot { notes: MidiNote[]; automation: AutomationPoint[] }

interface Voice { src: AudioBufferSourceNode; gain: GainNode }

type ChordNotes = { pitch: number; voice: VoiceIndex }[];

/** One play-to-pause run while capturing. Times are on the audio clock. */
interface Session {
  startedAt: number;
  startOffset: number;
  loop: LoopRegion | null;
  pass: number; // loop iteration currently playing
  events: { notes: ChordNotes; from: number; to: number | null }[];
  levels: { at: number; level: Intensity }[];
}

const RENDER_DEBOUNCE_MS = 120;
const XFADE = 0.012; // seconds (time constant)
const HISTORY_LIMIT = 200;
const LIVE_WINDOW = 1.6; // seconds of harmony rendered per live-chord request
const LIVE_REFRESH_MS = 60; // knob moves re-render a held chord at most this often
const TAKE_TAIL = 2.5;    // seconds of reverb kept after the last pass
const MIN_TAKE = 0.5;     // seconds
const MAX_TAKES = 12;

export class AudioEngine {
  private state: EngineState = { ...DEFAULT_ENGINE_STATE };
  private listeners = new Set<EngineListener>();

  private ctx: AudioContext | null = null;
  private graph: MixGraph | null = null;
  private duck: GainNode | null = null; // arrangement voices, ducked under a live chord
  private gateTarget = 1; // live mode: the bass sounds with the chords
  private worker: Worker | null = null;        // analysis + full renders
  private previewWorker: Worker | null = null; // live-chord windows, never queued behind a render
  private nextId = 1;
  private analyzeId = 0;
  private analysisF0: Float32Array | null = null; // null until the current file is analyzed
  private analysisHop = 0.005;

  // Background rendering
  private dirty = new Set<RenderPart>();
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private renderInFlight = 0;

  // Transport
  private sources: Partial<Record<TrackName, Voice>> = {};
  private startedAt = 0;   // ctx time when the current playback pass started
  private startOffset = 0; // timeline position at startedAt
  private pausedAt = 0;
  private endTimer: ReturnType<typeof setInterval> | null = null;

  // History
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  // Live chord (Messina-style playing over the track). Windows are scheduled on
  // the audio clock, so they stay in sync across loop wraps.
  private live: {
    notes: ChordNotes;
    cursorPos: number;  // timeline position of the next window
    cursorCtx: number;  // ctx time at which cursorPos will play
    pending: Map<number, { when: number; first: boolean }>;
    voices: Voice[];
    stale: Voice[];     // still sounding until a re-render (knob move, chord change) lands
    sounding: boolean;  // the first window has been scheduled
    timer: ReturnType<typeof setInterval> | null;
  } | null = null;
  private liveRefresh: ReturnType<typeof setTimeout> | null = null;

  // Takes
  private capture = false;
  private recorder: MasterRecorder | null = null;
  private recorderReady: Promise<MasterRecorder | null> | null = null;
  private session: Session | null = null;
  private pendingAudio: { id: string; from: number; to: number }[] = [];
  private takeCount = 0;
  private audition: { src: AudioBufferSourceNode; gain: GainNode; startedAt: number; take: Take } | null = null;

  // --- State plumbing -------------------------------------------------------

  // Arrow properties: stable identities for useSyncExternalStore
  subscribe = (listener: EngineListener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getState = (): EngineState => this.state;

  private update(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  getAudioContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.graph = createMixGraph(this.ctx, this.state.mixerState, this.state.fx);
      this.graph.output.connect(this.ctx.destination);
      this.duck = this.ctx.createGain();
      this.duck.connect(this.graph.inputs.harmony);
    }
    return this.ctx;
  }

  getMeters(): MixGraph['meters'] | null {
    return this.graph?.meters ?? null;
  }

  // --- Worker ----------------------------------------------------------------

  private spawnWorker(): Worker {
    return new Worker(new URL('./worker/dsp.worker.ts', import.meta.url), { type: 'module' });
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = this.spawnWorker();
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onWorkerMessage(e.data);
      this.worker.onerror = (e) => {
        this.renderInFlight = 0;
        this.update({ status: 'error', error: e.message || 'Audio worker crashed', rendering: false });
      };
    }
    return this.worker;
  }

  private getPreviewWorker(): Worker {
    if (!this.previewWorker) {
      this.previewWorker = this.spawnWorker();
      this.previewWorker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'previewed') this.onPreviewed(e.data);
      };
    }
    return this.previewWorker;
  }

  private send(req: WorkerRequest, transfer: Transferable[] = []): void {
    this.getWorker().postMessage(req, transfer);
  }

  private onWorkerMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'stage':
        if (msg.id === this.analyzeId) this.update({ renderStage: msg.stage });
        else if (msg.id === this.renderInFlight) this.update({ renderStage: msg.stage });
        break;
      case 'analyzed':
        if (msg.id === this.analyzeId) this.onAnalyzed(msg.result);
        break;
      case 'rendered':
        if (msg.id === this.renderInFlight) this.onRendered(msg);
        break;
      case 'error':
        if (msg.id === this.renderInFlight) this.renderInFlight = 0;
        this.update({ status: 'error', error: msg.message, rendering: false });
        break;
    }
  }

  // --- Loading ---------------------------------------------------------------

  async loadAudioUrl(url: string, name?: string): Promise<void> {
    try {
      this.update({ status: 'loading', error: undefined });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Couldn't fetch audio (${response.status})`);
      const audio = await this.getAudioContext().decodeAudioData(await response.arrayBuffer());
      this.initFromBuffer(audio, name ?? decodeURIComponent(url.split('/').pop() ?? 'audio'));
    } catch (err) {
      this.update({ status: 'error', error: err instanceof Error ? err.message : 'Failed to load audio' });
    }
  }

  async loadAudioFile(file: File): Promise<void> {
    try {
      this.update({ status: 'loading', error: undefined });
      const audio = await this.getAudioContext().decodeAudioData(await file.arrayBuffer());
      this.initFromBuffer(audio, file.name);
    } catch (err) {
      this.update({
        status: 'error',
        error: err instanceof Error ? `Couldn't read that file: ${err.message}` : 'Failed to load audio',
      });
    }
  }

  private initFromBuffer(audio: AudioBuffer, fileName: string): void {
    this.stopLiveChord();
    this.stopAudition();
    this.pause();
    this.pendingAudio = [];
    this.takeCount = 0;
    this.pausedAt = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty.clear();
    this.analysisF0 = null;
    this.renderInFlight = 0; // ignore any render still running for the previous file
    this.update({
      status: 'analyzing',
      renderStage: 'Listening for pitch',
      fileName: fileName.replace(/\.[^.]+$/, ''),
      audioBuffer: audio,
      duration: audio.duration,
      pitchContour: [],
      correctedContour: [],
      midiNotes: [],
      automationPoints: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: audio.duration, value: 0 },
      ],
      correctedBuffer: null,
      harmonyBuffer: null,
      bassBuffer: null,
      loop: null,
      canUndo: false,
      canRedo: false,
      held: null,
      passNotes: [],
      takes: [],
      selectedTake: null,
      recording: null,
    });

    // Both workers analyze the take (in parallel); each needs its own copy
    this.analyzeId = this.nextId++;
    for (const worker of [this.getWorker(), this.getPreviewWorker()]) {
      const channels: Float32Array[] = [];
      for (let c = 0; c < audio.numberOfChannels; c++) channels.push(new Float32Array(audio.getChannelData(c)));
      worker.postMessage(
        { type: 'analyze', id: this.analyzeId, channels, sampleRate: audio.sampleRate } satisfies WorkerRequest,
        channels.map(c => c.buffer),
      );
    }
  }

  private onAnalyzed(result: Extract<WorkerResponse, { type: 'analyzed' }>['result']): void {
    const contour: PitchContour = Array.from(result.f0, (freq, k) => ({
      time: k * result.hop,
      freq,
      confidence: result.confidence[k],
    }));
    this.analysisF0 = result.f0;
    this.analysisHop = result.hop;
    const useDetected = result.key.confidence > 0.3;
    this.update({
      status: 'ready',
      renderStage: '',
      pitchContour: contour,
      detectedKey: result.key.key,
      detectedScale: result.key.scale,
      detectedKeyConfidence: result.key.confidence,
      tuningCents: result.key.tuningCents,
      ...(useDetected ? { key: result.key.key, scale: result.key.scale } : {}),
    });
    this.markDirty(['corrected', 'harmony', 'bass'], 0);
  }

  // --- Rendering -------------------------------------------------------------

  private markDirty(parts: RenderPart[], delay = RENDER_DEBOUNCE_MS): void {
    for (const p of parts) this.dirty.add(p);
    if (!this.analysisF0) return;
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.flushRender(), delay);
  }

  private flushRender(): void {
    this.renderTimer = null;
    if (this.renderInFlight || this.dirty.size === 0 || !this.analysisF0) return;
    const parts = [...this.dirty];
    this.dirty.clear();
    this.renderInFlight = this.nextId++;
    this.update({ rendering: true });
    const s = this.state;
    this.send({
      type: 'render',
      id: this.renderInFlight,
      parts,
      params: {
        key: s.key,
        scale: s.scale,
        retuneSpeed: s.retuneSpeed,
        notes: s.midiNotes,
        voicing: s.voicing,
        automation: s.automationPoints,
      },
    });
  }

  private onRendered(msg: Extract<WorkerResponse, { type: 'rendered' }>): void {
    this.renderInFlight = 0;
    const audio = this.state.audioBuffer;
    if (!audio) return;
    const ctx = this.getAudioContext();
    const make = (channels: Float32Array[]) => {
      const b = ctx.createBuffer(channels.length, audio.length, audio.sampleRate);
      channels.forEach((c, i) => b.copyToChannel(c.subarray(0, audio.length) as Float32Array<ArrayBuffer>, i));
      return b;
    };

    const patch: Partial<EngineState> = { lastRenderMs: Math.round(msg.ms) };
    const changed: TrackName[] = [];
    if (msg.corrected) {
      patch.correctedBuffer = make([msg.corrected]);
      changed.push('corrected');
    }
    if (msg.correctedHz && this.analysisF0) {
      const f0 = this.analysisF0;
      const hz = msg.correctedHz;
      patch.correctedContour = Array.from(hz, (targetFreq, k): CorrectedPitchFrame => ({
        time: k * this.analysisHop,
        origFreq: f0[k],
        targetFreq,
      }));
    }
    if (msg.harmony) {
      patch.harmonyBuffer = make(msg.harmony);
      changed.push('harmony');
    }
    if (msg.bass) {
      patch.bassBuffer = make([msg.bass]);
      changed.push('bass');
    }

    const more = this.dirty.size > 0;
    this.update({ ...patch, rendering: more, renderStage: more ? this.state.renderStage : '' });
    if (this.state.playing) this.hotSwap(changed);
    if (more) this.flushRender();
  }

  // --- Parameters (re-render) --------------------------------------------------

  setKey(key: NoteName): void {
    this.update({ key });
    this.markDirty(['corrected', 'bass']);
  }

  setScale(scale: ScaleType): void {
    this.update({ scale });
    this.markDirty(['corrected', 'bass']);
  }

  setRetuneSpeed(ms: number): void {
    this.update({ retuneSpeed: ms });
    this.markDirty(['corrected', 'bass']);
  }

  setVoicing(patch: Partial<VoicingParams>): void {
    this.update({ voicing: { ...this.state.voicing, ...patch } });
    this.markDirty(['harmony']);
    this.refreshLive();
  }

  /** Turn every knob the intensity level owns at once, except the locked ones. */
  setIntensity(level: Intensity): void {
    const k = INTENSITY[level].knobs;
    const s = this.state;
    const locked = new Set(s.locks);
    const pick = (id: KnobId, current: number) => (locked.has(id) ? current : k[id]);
    const v = s.voicing;
    const voicing: VoicingParams = {
      ...v,
      glide: pick('glide', v.glide),
      humanize: pick('humanize', v.humanize),
      double: pick('double', v.double),
      width: pick('width', v.width),
      vary: pick('vary', v.vary),
      glitch: pick('glitch', v.glitch),
    };
    const fx: FxParams = { ...s.fx, space: pick('space', s.fx.space), warmth: pick('warmth', s.fx.warmth), drive: pick('drive', s.fx.drive) };
    const retuneSpeed = pick('retune', s.retuneSpeed);
    const rendered = (['glide', 'humanize', 'double', 'width', 'glitch'] as const).some(id => voicing[id] !== v[id]);
    const retuned = retuneSpeed !== s.retuneSpeed;
    this.update({ intensity: level, retuneSpeed, voicing, fx });
    this.graph?.setFx(fx);
    const parts: RenderPart[] = [];
    if (rendered) parts.push('harmony');
    if (retuned) parts.push('corrected', 'bass');
    if (parts.length) this.markDirty(parts);
    if (rendered) this.refreshLive();
    if (this.session && this.ctx) this.session.levels.push({ at: this.ctx.currentTime, level });
  }

  /** Lock knobs so intensity leaves them where they are (or unlock them). */
  setLocked(ids: KnobId[], locked: boolean): void {
    const locks = new Set(this.state.locks);
    for (const id of ids) {
      if (locked) locks.add(id);
      else locks.delete(id);
    }
    this.update({ locks: [...locks] });
  }

  // --- Parameters (live) -------------------------------------------------------

  setFx(patch: Partial<FxParams>): void {
    const fx = { ...this.state.fx, ...patch };
    this.update({ fx });
    this.graph?.setFx(fx);
    if (patch.gate !== undefined) this.updateBassGate();
  }

  /**
   * Live mode: the bass rides with the chords. It opens while a live chord (or
   * a prepared note) sings and sinks to the gate floor in between.
   */
  private updateBassGate(at?: number, immediate = false): void {
    const ctx = this.ctx;
    const gate = this.graph?.bassGate;
    if (!ctx || !gate) return;
    const t = this.getPlaybackTime();
    const singing = !!this.live?.sounding || this.state.midiNotes.some(n => t >= n.startTime && t < n.startTime + n.duration);
    const target = !this.capture || singing ? 1 : gateFloor(this.state.fx.gate);
    if (target === this.gateTarget && !immediate) return;
    this.gateTarget = target;
    const when = Math.max(at ?? 0, ctx.currentTime);
    gate.gain.cancelScheduledValues(when);
    if (immediate) gate.gain.setValueAtTime(target, when);
    else gate.gain.setTargetAtTime(target, when, target > gate.gain.value ? 0.012 : 0.09);
  }

  setMixerState(patch: Partial<MixerState>): void {
    const mixerState = { ...this.state.mixerState, ...patch };
    this.update({ mixerState });
    this.graph?.setMixer(mixerState);
  }

  setSolo(track: TrackName | null): void {
    const current = this.state.mixerState.solo;
    this.setMixerState({ solo: current === track ? null : track });
  }

  toggleMute(track: TrackName): void {
    const mute = { ...this.state.mixerState.mute, [track]: !this.state.mixerState.mute[track] };
    this.setMixerState({ mute });
  }

  // --- Notes & automation (undoable) -------------------------------------------

  /** Save the current notes/automation so the next edit can be undone. */
  checkpoint(): void {
    this.undoStack.push({ notes: this.state.midiNotes, automation: this.state.automationPoints });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.update({ canUndo: true, canRedo: false });
  }

  /** Replace all notes. Pass record: false for intermediate drag states. */
  setMidiNotes(notes: MidiNote[], opts: { record?: boolean } = {}): void {
    if (opts.record !== false) this.checkpoint();
    this.update({ midiNotes: notes });
    this.markDirty(['harmony']);
  }

  addMidiNotes(notes: Omit<MidiNote, 'id'>[]): MidiNote[] {
    const added = notes.map(n => ({ ...n, id: uid() }));
    this.setMidiNotes([...this.state.midiNotes, ...added]);
    return added;
  }

  removeMidiNotes(ids: string[]): void {
    const drop = new Set(ids);
    this.setMidiNotes(this.state.midiNotes.filter(n => !drop.has(n.id)));
  }

  setAutomationPoints(points: AutomationPoint[], opts: { record?: boolean } = {}): void {
    if (opts.record !== false) this.checkpoint();
    this.update({ automationPoints: [...points].sort((a, b) => a.time - b.time) });
    this.markDirty(['bass']);
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push({ notes: this.state.midiNotes, automation: this.state.automationPoints });
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push({ notes: this.state.midiNotes, automation: this.state.automationPoints });
    this.restore(next);
  }

  private restore(s: Snapshot): void {
    const parts: RenderPart[] = [];
    if (s.notes !== this.state.midiNotes) parts.push('harmony');
    if (s.automation !== this.state.automationPoints) parts.push('bass');
    this.update({
      midiNotes: s.notes,
      automationPoints: s.automation,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
    this.markDirty(parts);
  }

  // --- Transport -----------------------------------------------------------------

  private bufferFor(track: TrackName): AudioBuffer | null {
    const s = this.state;
    switch (track) {
      case 'dry': return s.audioBuffer;
      // Until the tuned lead exists, let the original stand in for it
      case 'corrected': return s.correctedBuffer ?? s.audioBuffer;
      case 'harmony': return s.harmonyBuffer;
      case 'bass': return s.bassBuffer;
    }
  }

  private startVoice(track: TrackName, when: number, position: number, fadeIn: boolean): void {
    const buffer = this.bufferFor(track);
    const ctx = this.ctx;
    if (!buffer || !ctx || !this.graph) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const loop = this.state.loop;
    if (loop) {
      src.loop = true;
      src.loopStart = loop.start;
      src.loopEnd = loop.end;
    }
    const gain = ctx.createGain();
    if (fadeIn) {
      gain.gain.setValueAtTime(0, when);
      gain.gain.setTargetAtTime(1, when, XFADE);
    }
    src.connect(gain).connect(track === 'harmony' && this.duck ? this.duck : this.graph.inputs[track]);
    src.start(when, Math.max(0, position));
    this.sources[track] = { src, gain };
  }

  private releaseVoice(v: Voice | undefined, at: number): void {
    if (!v) return;
    v.gain.gain.cancelScheduledValues(at);
    v.gain.gain.setTargetAtTime(0, at, XFADE);
    try { v.src.stop(at + XFADE * 6); } catch { /* already stopped */ }
  }

  async play(from?: number): Promise<void> {
    const audio = this.state.audioBuffer;
    if (!audio) return;
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    if (this.capture) await this.ensureRecorder();
    if (from === undefined && this.audition) from = this.getPlaybackTime();
    this.stopAudition();
    if (this.state.playing) {
      this.stopLiveChord();
      this.endSession(ctx.currentTime);
    }

    let position = from ?? this.pausedAt;
    const loop = this.state.loop;
    if (loop && (position < loop.start || position >= loop.end)) position = loop.start;
    if (position >= audio.duration - 0.01) position = 0;

    const now = ctx.currentTime;
    for (const name of TRACK_NAMES) this.releaseVoice(this.sources[name], now);
    this.sources = {};

    const when = now + 0.02;
    this.startedAt = when;
    this.startOffset = position;
    for (const name of TRACK_NAMES) this.startVoice(name, when, position, true);
    if (this.capture) this.startSession(when, position);
    this.updateBassGate(when, true);

    if (this.endTimer) clearInterval(this.endTimer);
    this.endTimer = setInterval(() => {
      if (!this.state.loop && this.getPlaybackTime() >= audio.duration - 0.005) {
        this.pause();
        this.pausedAt = 0;
        this.update({});
      } else {
        this.checkPass();
        this.updateBassGate();
      }
    }, 50);
    this.update({ playing: true });
  }

  pause(): void {
    if (this.audition) {
      this.stopAudition();
      return;
    }
    if (!this.state.playing) return;
    this.pausedAt = this.getPlaybackTime();
    this.stopLiveChord();
    const now = this.ctx?.currentTime ?? 0;
    this.endSession(now);
    for (const name of TRACK_NAMES) this.releaseVoice(this.sources[name], now);
    this.sources = {};
    if (this.endTimer) clearInterval(this.endTimer);
    this.endTimer = null;
    this.update({ playing: false });
  }

  togglePlay(): void {
    if (this.state.playing || this.audition) this.pause();
    else void this.play();
  }

  /** Stop and return to the start (or the loop start). */
  stop(): void {
    this.pause();
    this.pausedAt = this.state.loop?.start ?? 0;
    this.update({});
  }

  seek(time: number): void {
    this.stopAudition();
    const t = Math.max(0, Math.min(this.state.duration, time));
    if (this.state.playing) void this.play(t);
    else {
      this.pausedAt = t;
      this.update({});
    }
  }

  getPlaybackTime(): number {
    if (this.audition && this.ctx) {
      const { take, startedAt } = this.audition;
      return take.start + Math.min(take.end - take.start, Math.max(0, this.ctx.currentTime - startedAt));
    }
    if (!this.state.playing || !this.ctx) return this.pausedAt;
    const elapsed = Math.max(0, this.ctx.currentTime - this.startedAt);
    return this.timelineAt(this.startOffset + elapsed);
  }

  /** Map an unwrapped position (offset + elapsed) onto the timeline, honoring the loop. */
  private timelineAt(pos: number): number {
    const loop = this.state.loop;
    if (loop && pos >= loop.end) {
      return loop.start + ((pos - loop.end) % (loop.end - loop.start));
    }
    return Math.min(pos, this.state.duration);
  }

  getIsPlaying(): boolean {
    return this.state.playing;
  }

  setLoop(loop: LoopRegion | null): void {
    const valid = loop && loop.end - loop.start >= 0.2 ? loop : null;
    const wasPlaying = this.state.playing;
    const position = this.getPlaybackTime();
    if (wasPlaying) this.pause();
    this.update({ loop: valid });
    if (wasPlaying) void this.play(position);
    else if (valid && (this.pausedAt < valid.start || this.pausedAt >= valid.end)) {
      this.pausedAt = valid.start;
      this.update({});
    }
  }

  /** Crossfade freshly rendered tracks in under the playhead. */
  private hotSwap(tracks: TrackName[]): void {
    const ctx = this.ctx;
    if (!ctx || tracks.length === 0) return;
    const when = ctx.currentTime + 0.01;
    // Position of the playhead at `when`, as an offset into the buffer
    const position = this.timelineAt(this.startOffset + (when - this.startedAt));
    for (const name of tracks) {
      const old = this.sources[name];
      this.startVoice(name, when, position, true);
      this.releaseVoice(old, when);
    }
  }

  // --- Live chords (play the harmonizer over the track) ----------------------------

  /**
   * Start sounding a chord at the playhead, like holding keys on the Messina.
   * Harmony is rendered in short windows ahead of the playhead while held.
   */
  startLiveChord(notes: ChordNotes): void {
    const ctx = this.ctx;
    if (!this.state.playing || !this.analysisF0 || !ctx) return;
    const start = this.getPlaybackTime();
    const session = this.session;
    const live = this.live;
    if (live) {
      // A chord change while holding (another key, an octave): the old chord
      // sounds until the new one lands, then they crossfade, with no gap
      const event = session?.events.find(e => e.to === null);
      if (event) event.to = ctx.currentTime;
      session?.events.push({ notes, from: ctx.currentTime, to: null });
      live.notes = notes;
      live.pending.clear();
      live.stale.push(...live.voices.splice(0));
      live.cursorPos = start;
      live.cursorCtx = ctx.currentTime;
      this.update({ held: { notes, start }, passNotes: this.passNotes(), recording: this.recordingTake() });
      this.requestLiveWindow(true);
      return;
    }
    this.live = {
      notes,
      cursorPos: start,
      cursorCtx: ctx.currentTime,
      pending: new Map(),
      voices: [],
      stale: [],
      sounding: false,
      timer: null,
    };
    this.session?.events.push({ notes, from: ctx.currentTime, to: null });
    this.update({ held: { notes, start }, recording: this.recordingTake() });
    this.requestLiveWindow(true);
    this.live.timer = setInterval(() => {
      const live = this.live;
      if (live && this.ctx && live.cursorCtx - this.ctx.currentTime < LIVE_WINDOW * 0.6) this.requestLiveWindow(false);
    }, 60);
  }

  /** Re-render a held chord from the playhead, so knob moves are heard right away. */
  private refreshLive(): void {
    if (!this.live || this.liveRefresh) return;
    this.liveRefresh = setTimeout(() => {
      this.liveRefresh = null;
      const live = this.live;
      const ctx = this.ctx;
      if (!live || !ctx) return;
      live.pending.clear();
      live.stale.push(...live.voices.splice(0));
      live.cursorPos = this.getPlaybackTime();
      live.cursorCtx = ctx.currentTime;
      this.requestLiveWindow(true);
    }, LIVE_REFRESH_MS);
  }

  private requestLiveWindow(first: boolean): void {
    const live = this.live;
    if (!live) return;
    const loop = this.state.loop;
    if (loop && live.cursorPos >= loop.end - 1e-3) {
      live.cursorPos = loop.start;
    }
    const from = live.cursorPos;
    const limit = loop && from < loop.end ? loop.end : this.state.duration;
    const to = Math.min(limit, from + LIVE_WINDOW);
    if (to - from < 0.01) return;

    const id = this.nextId++;
    live.pending.set(id, { when: live.cursorCtx, first });
    live.cursorCtx += to - from;
    live.cursorPos = to;
    // Notes span the whole take so windows after a loop wrap still sing
    const span = this.state.duration + 1;
    this.getPreviewWorker().postMessage({
      type: 'preview',
      id,
      start: from,
      end: to,
      notes: live.notes.map(n => ({ ...n, id: 'live', startTime: 0, duration: span })),
      voicing: this.state.voicing,
    } satisfies WorkerRequest);
  }

  private onPreviewed(msg: Extract<WorkerResponse, { type: 'previewed' }>): void {
    const live = this.live;
    const ctx = this.ctx;
    const slot = live?.pending.get(msg.id);
    if (!live || !ctx || !this.graph || !slot || !this.state.playing) return;
    live.pending.delete(msg.id);
    const [l, r] = msg.harmony;
    const buffer = ctx.createBuffer(2, l.length, ctx.sampleRate);
    buffer.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(r as Float32Array<ArrayBuffer>, 1);

    // Windows normally arrive ahead of time; the first one is always a hair late
    const now = ctx.currentTime;
    let when = slot.when;
    let offset = 0;
    if (when < now + 0.005) {
      offset = now + 0.005 - when;
      when = now + 0.005;
    }
    if (offset >= buffer.duration) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    if (slot.first || offset > 0) {
      gain.gain.setValueAtTime(0, when);
      gain.gain.setTargetAtTime(1, when, 0.008);
    }
    if (slot.first) {
      // The live chord takes over: prepared voices duck, the previous render
      // fades, and the bass comes in with the chord
      this.duck?.gain.setTargetAtTime(0, when, 0.03);
      live.sounding = true;
      this.updateBassGate(when);
      for (const v of live.stale.splice(0)) {
        v.gain.gain.cancelScheduledValues(when);
        v.gain.gain.setTargetAtTime(0, when, 0.008);
        try { v.src.stop(when + 0.1); } catch { /* already stopped */ }
      }
    }
    src.connect(gain).connect(this.graph.inputs.harmony);
    src.start(when, offset);
    live.voices.push({ src, gain });
    src.onended = () => {
      const i = live.voices.findIndex(v => v.src === src);
      if (i >= 0) live.voices.splice(i, 1);
    };
  }

  /** Release the live chord. */
  stopLiveChord(): void {
    const live = this.live;
    if (!live) return;
    this.live = null;
    if (live.timer) clearInterval(live.timer);
    const now = this.ctx?.currentTime ?? 0;
    for (const v of [...live.voices, ...live.stale]) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.03);
      try { v.src.stop(now + 0.25); } catch { /* already stopped */ }
    }
    this.duck?.gain.cancelScheduledValues(now);
    this.duck?.gain.setTargetAtTime(1, now, 0.05);
    this.updateBassGate();
    const event = this.session?.events.find(e => e.to === null);
    if (event) event.to = now;
    this.update({ held: null, passNotes: this.passNotes() });
  }

  // --- Takes -----------------------------------------------------------------------

  /** Live mode records every pass; prepare mode doesn't. */
  setCapture(on: boolean): void {
    if (on === this.capture) return;
    this.capture = on;
    const ctx = this.ctx;
    if (!ctx) return;
    this.updateBassGate();
    if (on) {
      void this.ensureRecorder();
      // Switched to live mid-playback: this pass counts from here
      if (this.state.playing) this.startSession(ctx.currentTime, this.getPlaybackTime());
    } else if (this.session) {
      this.endSession(ctx.currentTime);
    }
  }

  private ensureRecorder(): Promise<MasterRecorder | null> {
    if (!this.recorderReady) {
      const ctx = this.getAudioContext();
      this.recorderReady = MasterRecorder.create(ctx, this.graph!.output).then(
        rec => {
          rec.onChunk = () => this.resolveTakeAudio();
          this.recorder = rec;
          if (this.session) rec.setRecording(true);
          return rec;
        },
        () => null, // no AudioWorklet: takes keep their notes, without audio
      );
    }
    return this.recorderReady;
  }

  private startSession(startedAt: number, startOffset: number): void {
    // A new pass cuts the previous take's reverb tail short
    const frame = Math.round(startedAt * (this.ctx?.sampleRate ?? 48000));
    for (const p of this.pendingAudio) p.to = Math.min(p.to, Math.max(p.from, frame));
    this.session = {
      startedAt,
      startOffset,
      loop: this.state.loop,
      pass: 0,
      events: [],
      levels: [{ at: startedAt, level: this.state.intensity }],
    };
    this.recorder?.setRecording(true);
    this.update({ passNotes: [], recording: null });
  }

  /** Audio-clock time at which loop iteration `k` of the session began. */
  private passStart(s: Session, k: number): number {
    if (k === 0 || !s.loop) return s.startedAt;
    return s.startedAt + (s.loop.end - s.startOffset) + (k - 1) * (s.loop.end - s.loop.start);
  }

  private passAt(s: Session, at: number): number {
    if (!s.loop) return 0;
    const firstWrap = s.startedAt + (s.loop.end - s.startOffset);
    return at < firstWrap ? 0 : 1 + Math.floor((at - firstWrap) / (s.loop.end - s.loop.start));
  }

  /** Called while playing: a loop wrap closes the pass and starts the next. */
  private checkPass(): void {
    const s = this.session;
    const ctx = this.ctx;
    if (!s || !ctx) return;
    const k = this.passAt(s, ctx.currentTime);
    if (k <= s.pass) return;
    for (let p = s.pass; p < k; p++) this.finishPass(s, p, this.passStart(s, p + 1), 0);
    s.pass = k;
    const held = this.state.held;
    this.update({
      passNotes: this.passNotes(),
      held: held && s.loop ? { ...held, start: s.loop.start } : held,
      recording: this.recordingTake(),
    });
  }

  /** The take the current pass will become, once a chord has been played in it. */
  private recordingTake(): EngineState['recording'] {
    const s = this.session;
    if (!s) return null;
    const start = this.passStart(s, s.pass);
    if (!s.events.some(e => e.to === null || e.to - Math.max(e.from, start) >= 0.05)) return null;
    return { number: this.takeCount + 1, start: s.pass === 0 || !s.loop ? s.startOffset : s.loop.start };
  }

  private endSession(at: number): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    for (const e of s.events) if (e.to === null) e.to = at;
    this.finishPass(s, s.pass, at, TAKE_TAIL);
    this.update({ passNotes: [], recording: null });
    this.resolveTakeAudio();
  }

  /** Turn pass `k` (ending at `end` on the audio clock) into a take, if chords were played. */
  private finishPass(s: Session, k: number, end: number, tail: number): void {
    const start = this.passStart(s, k);
    if (end - start < MIN_TAKE || !this.ctx) return;
    const t0 = k === 0 || !s.loop ? s.startOffset : s.loop.start;
    const toTimeline = (at: number) => t0 + (at - start);
    const notes: MidiNote[] = [];
    for (const e of s.events) {
      const a = Math.max(e.from, start), b = Math.min(e.to ?? end, end);
      if (b - a < 0.05) continue;
      for (const n of e.notes) notes.push({ id: uid(), pitch: n.pitch, voice: n.voice, startTime: toTimeline(a), duration: b - a });
    }
    if (notes.length === 0) return;

    let level = s.levels[0].level;
    const levels: Take['levels'] = [];
    for (const l of s.levels) {
      if (l.at <= start) level = l.level;
      else if (l.at < end) levels.push({ time: toTimeline(l.at), level: l.level });
    }
    levels.unshift({ time: t0, level });

    const sr = this.ctx.sampleRate;
    const take: Take = {
      id: uid(),
      number: ++this.takeCount,
      start: t0,
      end: toTimeline(end),
      notes,
      levels,
      audio: null,
      sampleRate: sr,
      saved: false,
    };
    if (this.recorder) this.pendingAudio.push({ id: take.id, from: Math.round(start * sr), to: Math.round((end + tail) * sr) });
    const takes = [take, ...this.state.takes];
    // Past the limit, forget the oldest unsaved take (or the oldest of all)
    while (takes.length > MAX_TAKES) {
      const i = takes.map(t => t.saved).lastIndexOf(false);
      takes.splice(i >= 0 ? i : takes.length - 1, 1);
    }
    this.pendingAudio = this.pendingAudio.filter(p => takes.some(t => t.id === p.id));
    this.update({ takes, selectedTake: take.id });
  }

  /** Attach recorded audio to takes whose pass (and tail) is fully recorded. */
  private resolveTakeAudio(): void {
    const rec = this.recorder;
    if (!rec) return;
    const ready = this.pendingAudio.filter(p => rec.received >= p.to);
    if (ready.length) {
      this.pendingAudio = this.pendingAudio.filter(p => rec.received < p.to);
      const audio = new Map(ready.map(p => [p.id, rec.extract(p.from, p.to)]));
      this.update({ takes: this.state.takes.map(t => (audio.has(t.id) ? { ...t, audio: audio.get(t.id)! } : t)) });
    }
    const s = this.session;
    const needed = Math.min(
      s ? Math.round(this.passStart(s, s.pass) * (this.ctx?.sampleRate ?? 48000)) : Infinity,
      ...this.pendingAudio.map(p => p.from),
    );
    if (needed === Infinity) rec.setRecording(false);
    else rec.trim(needed);
  }

  /** Chords played so far in the current pass, in timeline positions. */
  private passNotes(): MidiNote[] {
    const s = this.session;
    if (!s) return [];
    const start = this.passStart(s, s.pass);
    const t0 = s.pass === 0 || !s.loop ? s.startOffset : s.loop.start;
    const notes: MidiNote[] = [];
    for (const e of s.events) {
      if (e.to === null) continue;
      const a = Math.max(e.from, start);
      if (e.to - a < 0.05) continue;
      for (const n of e.notes) notes.push({ id: uid(), pitch: n.pitch, voice: n.voice, startTime: t0 + (a - start), duration: e.to - a });
    }
    return notes;
  }

  selectTake(id: string | null): void {
    this.update({ selectedTake: id });
  }

  /** Listen back to a take exactly as it was heard. */
  async playTake(id: string): Promise<void> {
    const take = this.state.takes.find(t => t.id === id);
    if (!take?.audio) return;
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    this.pause();
    this.stopAudition();
    const [l, r] = take.audio;
    const buffer = ctx.createBuffer(2, l.length, take.sampleRate);
    buffer.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    src.connect(gain).connect(ctx.destination);
    if (this.graph) gain.connect(this.graph.meters.master);
    const startedAt = ctx.currentTime + 0.02;
    src.start(startedAt);
    this.audition = { src, gain, startedAt, take };
    src.onended = () => {
      if (this.audition?.src === src) this.stopAudition();
    };
    this.update({ auditioning: id, selectedTake: id });
  }

  stopAudition(): void {
    const a = this.audition;
    if (!a) return;
    this.pausedAt = this.getPlaybackTime();
    this.audition = null;
    const now = this.ctx?.currentTime ?? 0;
    a.gain.gain.setTargetAtTime(0, now, XFADE);
    try { a.src.stop(now + XFADE * 6); } catch { /* already stopped */ }
    this.update({ auditioning: null });
  }

  /** Download a take as WAV. */
  saveTake(id: string): void {
    const take = this.state.takes.find(t => t.id === id);
    if (!take?.audio) return;
    const ctx = this.getAudioContext();
    const buffer = ctx.createBuffer(2, take.audio[0].length, take.sampleRate);
    buffer.copyToChannel(take.audio[0] as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(take.audio[1] as Float32Array<ArrayBuffer>, 1);
    download(toWav(buffer), `${this.state.fileName ?? 'prizmiker'} - take ${take.number} (prizmiker).wav`);
    this.update({ takes: this.state.takes.map(t => (t.id === id ? { ...t, saved: true } : t)) });
  }

  /** Make a take's chords the prepared notes (undoable). */
  takeToNotes(id: string): void {
    const take = this.state.takes.find(t => t.id === id);
    if (!take) return;
    this.setMidiNotes(take.notes.map(n => ({ ...n, id: uid() })));
  }

  discardTake(id: string): void {
    if (this.state.auditioning === id) this.stopAudition();
    this.pendingAudio = this.pendingAudio.filter(p => p.id !== id);
    const takes = this.state.takes.filter(t => t.id !== id);
    this.update({ takes, selectedTake: this.state.selectedTake === id ? takes[0]?.id ?? null : this.state.selectedTake });
  }

  // --- Export ---------------------------------------------------------------------

  async exportWav(): Promise<void> {
    const audio = this.state.audioBuffer;
    if (!audio) return;
    const tail = 3.5;
    const sr = audio.sampleRate;
    const offline = new OfflineAudioContext(2, Math.ceil((audio.duration + tail) * sr), sr);
    const graph = createMixGraph(offline, this.state.mixerState, this.state.fx);
    graph.output.connect(offline.destination);
    for (const name of TRACK_NAMES) {
      const buffer = this.bufferFor(name);
      if (!buffer) continue;
      const src = offline.createBufferSource();
      src.buffer = buffer;
      src.connect(graph.inputs[name]);
      src.start(0);
    }
    const rendered = await offline.startRendering();
    download(toWav(rendered), `${this.state.fileName ?? 'prizmiker'} (prizmiker).wav`);
  }

  dispose(): void {
    this.stopAudition();
    this.pause();
    this.worker?.terminate();
    this.worker = null;
    this.previewWorker?.terminate();
    this.previewWorker = null;
    void this.ctx?.close();
    this.ctx = null;
    this.graph = null;
  }
}

function download(wav: ArrayBuffer, name: string): void {
  const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
