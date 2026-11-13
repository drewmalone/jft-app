import type { TranscriptionState } from '../../transcription/types';
import { MicrophoneIcon } from './microphone-icon';
import { SpeechBars } from './speech-bars';

const buttonLabels: Record<TranscriptionState, string> = {
  unsupported: 'Record your share',
  idle: 'Record your share',
  error: 'Record your share',
  starting: 'Cancel microphone',
  connecting: 'Cancel connection',
  listening: 'Stop listening',
  stopping: 'Finishing transcription…'
};

type RecordingControlsProps = {
  state: TranscriptionState;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
};

/** Microphone action and decorative accents; the parent owns recognition and activity state. */
export function RecordingControls({
  state,
  active,
  disabled,
  onToggle
}: RecordingControlsProps) {
  return (
    <div className="microphone-stage">
      <SpeechBars />
      <div className="microphone-ring">
        <button
          type="button"
          className="record-button"
          aria-label={buttonLabels[state]}
          aria-pressed={active}
          disabled={disabled || state === 'unsupported' || state === 'stopping'}
          onClick={onToggle}
        >
          {active ? (
            <svg
              aria-hidden="true"
              width="68"
              height="68"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <MicrophoneIcon />
          )}
        </button>
      </div>
      <SpeechBars />
    </div>
  );
}
