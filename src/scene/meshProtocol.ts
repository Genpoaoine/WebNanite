import type { MeshPayload } from './meshTypes';

export interface BuildRequest {
  type: 'build';
}

export type BuildResponse =
  | { type: 'progress'; progress: number; label: string }
  | { type: 'done'; payload: MeshPayload }
  | { type: 'error'; message: string };
