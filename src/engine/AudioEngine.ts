/**
 * AudioEngine: owns the AudioContext, the mix graph and the DSP worker.
 *
 * Analysis and rendering run in a worker, and rendering is automatic: any edit
 * marks the affected tracks dirty and a debounced render follows. Fresh tracks
 * are crossfaded in under the playhead, so edits can be heard mid-playback.
 * The mix (faders, mute/solo, space, warmth) is live Web Audio and costs
 * nothing to change.
 */
import {
  AutomationPoint,
  CorrectedPitchFrame,
  DEFAULT_ENGINE_STATE,
  EngineState,
  FxParams,
  LoopRegion,
  MidiNote,
  MixerState,
  NoteName,
  PitchContour,
  ScaleType,
  TrackName,
  VoicingParams,
  uid,
} from './types';
import { createMixGraph, MixGraph, TRACK_NAMES } from './fx';
import { RenderPart, WorkerRequest, WorkerResponse } from './worker/protocol';
import toWav from 'audiobuffer-to-wav';

export type EngineListener = (state: EngineState) => void;

interface Snapshot { notes: MidiNote[]; automation: AutomationPoint[] }

interface Voice { src: AudioBufferSourceNode; gain: GainNode }

const RENDER_DEBOUNCE_MS = 120;
const XFADE = 0.012; // seconds (time constant)
const HISTORY_LIMIT = 200;
const LIVE_WINDOW = 1.6; // seconds of harmony rendered per live-chord request

export class AudioEngine {
  private state: EngineState = { ...DEFAULT_ENGINE_STATE };
  private listeners = new Set<EngineListener>();

  private ctx: AudioContext | null = null;
  private graph: MixGraph | null = null;
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
    notes: Omit<MidiNote, 'id' | 'startTime' | 'duration'>[];
    start: number;      // timeline position where the chord began
    cursorPos: number;  // timeline position of the next window
    cursorCtx: number;  // ctx time at which cursorPos will play
    wrapped: boolean;   // the loop wrapped while the chord was held
    pending: Map<number, { when: number; first: boolean }>;
    voices: Voice[];
    timer: ReturnType<typeof setInterval> | null;
  } | null = null;

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
    this.pause();
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
  }

  // --- Parameters (live) -------------------------------------------------------

  setFx(patch: Partial<FxParams>): void {
    const fx = { ...this.state.fx, ...patch };
    this.update({ fx });
    this.graph?.setFx(fx);
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
    src.connect(gain).connect(this.graph.inputs[track]);
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

    if (this.endTimer) clearInterval(this.endTimer);
    this.endTimer = setInterval(() => {
      if (!this.state.loop && this.getPlaybackTime() >= audio.duration - 0.005) {
        this.pause();
        this.pausedAt = 0;
        this.update({});
      }
    }, 100);
    this.update({ playing: true });
  }

  pause(): void {
    if (!this.state.playing) return;
    this.pausedAt = this.getPlaybackTime();
    this.stopLiveChord();
    const now = this.ctx?.currentTime ?? 0;
    for (const name of TRACK_NAMES) this.releaseVoice(this.sources[name], now);
    this.sources = {};
    if (this.endTimer) clearInterval(this.endTimer);
    this.endTimer = null;
    this.update({ playing: false });
  }

  togglePlay(): void {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  /** Stop and return to the start (or the loop start). */
  stop(): void {
    this.pause();
    this.pausedAt = this.state.loop?.start ?? 0;
    this.update({});
  }

  seek(time: number): void {
    const t = Math.max(0, Math.min(this.state.duration, time));
    if (this.state.playing) void this.play(t);
    else {
      this.pausedAt = t;
      this.update({});
    }
  }

  getPlaybackTime(): number {
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
  startLiveChord(notes: Omit<MidiNote, 'id' | 'startTime' | 'duration'>[]): void {
    const ctx = this.ctx;
    if (!this.state.playing || !this.analysisF0 || !ctx) return;
    this.stopLiveChord();
    const start = this.getPlaybackTime();
    this.live = {
      notes,
      start,
      cursorPos: start,
      cursorCtx: ctx.currentTime,
      wrapped: false,
      pending: new Map(),
      voices: [],
      timer: null,
    };
    this.requestLiveWindow(true);
    this.live.timer = setInterval(() => {
      const live = this.live;
      if (live && this.ctx && live.cursorCtx - this.ctx.currentTime < LIVE_WINDOW * 0.6) this.requestLiveWindow(false);
    }, 60);
  }

  private requestLiveWindow(first: boolean): void {
    const live = this.live;
    if (!live) return;
    const loop = this.state.loop;
    if (loop && live.cursorPos >= loop.end - 1e-3) {
      live.cursorPos = loop.start;
      live.wrapped = true;
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
    src.connect(gain).connect(this.graph.inputs.harmony);
    src.start(when, offset);
    live.voices.push({ src, gain });
    src.onended = () => {
      const i = live.voices.findIndex(v => v.src === src);
      if (i >= 0) live.voices.splice(i, 1);
    };
  }

  /** Release the live chord; returns the notes as played (for recording). */
  stopLiveChord(): Omit<MidiNote, 'id'>[] {
    const live = this.live;
    if (!live) return [];
    this.live = null;
    if (live.timer) clearInterval(live.timer);
    const end = this.getPlaybackTime();
    const now = this.ctx?.currentTime ?? 0;
    for (const v of live.voices) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.03);
      try { v.src.stop(now + 0.25); } catch { /* already stopped */ }
    }
    // If the loop wrapped, keep the part from the press to the loop end
    const loopEnd = this.state.loop?.end ?? this.state.duration;
    const duration = live.wrapped || end < live.start ? loopEnd - live.start : end - live.start;
    if (duration < 0.05) return [];
    return live.notes.map(n => ({ ...n, startTime: live.start, duration }));
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
    const blob = new Blob([toWav(rendered)], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.state.fileName ?? 'prizmiker'} (prizmiker).wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  dispose(): void {
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
