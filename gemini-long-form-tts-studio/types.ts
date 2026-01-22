
export type VoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export enum AudioStatus {
  IDLE = 'idle',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface Segment {
  id: string;
  name: string;
  text: string;
  status: AudioStatus;
  audioBlob?: Blob;
  error?: string;
  progress?: number;
}

export interface GenerationSettings {
  voice: VoiceName;
  speed: number;
  pitch: number;
  emotion: string;
  language: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'male' | 'female';
  baseVoice: VoiceName;
  description: string;
}
