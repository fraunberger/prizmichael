/**
 * Messages between the AudioEngine (main thread) and the DSP worker.
 * Audio crosses the boundary as transferable Float32Arrays.
 */
import { AutomationPoint, MidiNote, NoteName, ScaleType, VoicingParams } from '../types';
import { KeyEstimate } from '../dsp/key';

export type RenderPart = 'corrected' | 'harmony' | 'bass';

export interface RenderParams {
  key: NoteName;
  scale: ScaleType;
  retuneSpeed: number;
  notes: MidiNote[];
  voicing: VoicingParams;
  automation: AutomationPoint[];
}

export type WorkerRequest =
  | { type: 'analyze'; id: number; channels: Float32Array[]; sampleRate: number }
  | { type: 'render'; id: number; parts: RenderPart[]; params: RenderParams }
  | {
      // Short harmony window for live chord playing (see AudioEngine.previewChord)
      type: 'preview';
      id: number;
      start: number;
      end: number;
      notes: MidiNote[];
      voicing: VoicingParams;
    };

export interface AnalysisResult {
  hop: number;
  f0: Float32Array;
  confidence: Float32Array;
  rms: Float32Array;
  key: KeyEstimate;
}

export type WorkerResponse =
  | { type: 'analyzed'; id: number; result: AnalysisResult; ms: number }
  | {
      type: 'rendered';
      id: number;
      corrected?: Float32Array;
      correctedHz?: Float32Array;
      harmony?: [Float32Array, Float32Array];
      bass?: Float32Array;
      ms: number;
    }
  | { type: 'previewed'; id: number; start: number; harmony: [Float32Array, Float32Array] }
  | { type: 'stage'; id: number; stage: string }
  | { type: 'error'; id: number; message: string };
