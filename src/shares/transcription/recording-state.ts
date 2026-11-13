import type { TranscriptionState } from './types';
export type RecordingSnapshot = {
  state: TranscriptionState;
  speaking: boolean;
  interim: string;
  message: string;
};
export const initialRecordingState: RecordingSnapshot = {
  state: 'unsupported',
  speaking: false,
  interim: '',
  message: ''
};
type Action =
  | { type: 'support'; supported: boolean }
  | { type: 'start' | 'connecting' | 'listening' | 'stop' }
  | { type: 'activity'; speaking: boolean }
  | { type: 'interim'; text: string }
  | { type: 'finish'; failed: boolean; message: string };
/** Only transport callbacks from the live generation reach these UI transitions. */
export function reduceRecording(
  current: RecordingSnapshot,
  action: Action
): RecordingSnapshot {
  switch (action.type) {
    case 'support':
      return {
        ...initialRecordingState,
        state: action.supported ? 'idle' : 'unsupported'
      };
    case 'start':
      return { ...initialRecordingState, state: 'starting' };
    case 'connecting':
      return current.state === 'starting'
        ? { ...current, state: 'connecting' }
        : current;
    case 'listening':
      return current.state === 'starting' || current.state === 'connecting'
        ? { ...current, state: 'listening' }
        : current;
    case 'stop':
      return { ...current, state: 'stopping' };
    case 'activity':
      return { ...current, speaking: action.speaking };
    case 'interim':
      return { ...current, interim: action.text };
    case 'finish':
      return {
        ...initialRecordingState,
        state: action.failed ? 'error' : 'idle',
        message: action.message
      };
  }
}
