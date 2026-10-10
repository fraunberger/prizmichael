/**
 * Taps the master output, so a take is exactly what was heard. The worklet
 * streams blocks tagged with their frame on the audio clock; the engine keeps
 * only what pending takes still need and slices takes out by frame.
 */

const WORKLET = `
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.size = 0;
    this.frame = 0;
    this.l = new Float32Array(8192);
    this.r = new Float32Array(8192);
    this.port.onmessage = e => {
      this.on = e.data;
      if (!this.on) this.flush();
    };
  }
  flush() {
    if (!this.size) return;
    const l = this.l.slice(0, this.size), r = this.r.slice(0, this.size);
    this.port.postMessage({ frame: this.frame, l, r }, [l.buffer, r.buffer]);
    this.size = 0;
  }
  process(inputs) {
    if (!this.on) return true;
    const input = inputs[0] || [];
    const n = input[0] ? input[0].length : 128;
    if (this.size === 0) this.frame = currentFrame;
    if (input[0]) {
      this.l.set(input[0], this.size);
      this.r.set(input[1] || input[0], this.size);
    } else {
      this.l.fill(0, this.size, this.size + n);
      this.r.fill(0, this.size, this.size + n);
    }
    this.size += n;
    if (this.size + 128 > this.l.length) this.flush();
    return true;
  }
}
registerProcessor('prizmichael-recorder', Recorder);
`;

interface Chunk { frame: number; l: Float32Array; r: Float32Array }

export class MasterRecorder {
  private node: AudioWorkletNode;
  private chunks: Chunk[] = [];
  private on = false;
  /** Frame just past the newest audio received. */
  received = 0;
  onChunk: (() => void) | null = null;

  private constructor(node: AudioWorkletNode) {
    this.node = node;
    node.port.onmessage = (e: MessageEvent<Chunk>) => {
      this.chunks.push(e.data);
      this.received = e.data.frame + e.data.l.length;
      this.onChunk?.();
    };
  }

  static async create(ctx: AudioContext, source: AudioNode): Promise<MasterRecorder> {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(ctx, 'prizmichael-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    source.connect(node);
    // Keep it pulled by the graph; its output is silent
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    return new MasterRecorder(node);
  }

  setRecording(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.node.port.postMessage(on);
    if (!on) this.chunks = [];
  }

  /** Copy frames [from, to) (zeros where nothing was recorded). */
  extract(from: number, to: number): [Float32Array, Float32Array] {
    const n = Math.max(0, to - from);
    const l = new Float32Array(n), r = new Float32Array(n);
    for (const c of this.chunks) {
      const a = Math.max(from, c.frame), b = Math.min(to, c.frame + c.l.length);
      if (b <= a) continue;
      l.set(c.l.subarray(a - c.frame, b - c.frame), a - from);
      r.set(c.r.subarray(a - c.frame, b - c.frame), a - from);
    }
    return [l, r];
  }

  /** Forget audio before a frame nothing needs any more. */
  trim(before: number): void {
    this.chunks = this.chunks.filter(c => c.frame + c.l.length > before);
  }
}
