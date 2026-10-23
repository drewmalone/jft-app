import { useEffect, useId, useState, type FormEvent } from 'react';
import { LiveTranscript } from './live-transcript';
import { useTranscription } from '../transcription/use-transcription';

const buttonLabels = {
  unsupported: 'Record your share',
  idle: 'Record your share',
  error: 'Record your share',
  starting: 'Cancel microphone',
  listening: 'Stop listening',
  stopping: 'Finishing transcription…'
};
const statusLabels = {
  unsupported:
    'Voice transcription is not available in this browser. You can still type your share.',
  starting: 'Waiting for microphone access…',
  listening: 'Listening...',
  stopping: 'Finishing your words…'
};
const barHeights = [16, 28, 40, 56, 70, 56, 40, 28, 16];
function SpeechBars() {
  return (
    <div className="speech-bars" aria-hidden="true">
      {barHeights.map((height, index) => (
        <span
          key={index}
          style={{ height, animationDelay: `${index * 70}ms` }}
        />
      ))}
    </div>
  );
}

type ShareFormProps = {
  text: string;
  disabled: boolean;
  saving: boolean;
  error: string;
  onTextChange: (text: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
};

/** The parent owns the draft and clears it only after a confirmed save. */
export function ShareForm({
  text,
  disabled,
  saving,
  error,
  onTextChange,
  onSave
}: ShareFormProps) {
  const voice = useTranscription(text, onTextChange);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (voice.state !== 'listening') return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [voice.state]);
  const buttonLabel = buttonLabels[voice.state];
  const statusLabel =
    voice.state === 'idle' || voice.state === 'error'
      ? voice.message || 'Tap the microphone to begin, or type below.'
      : statusLabels[voice.state];
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  return (
    <form
      onSubmit={(event) => {
        if (voice.active) {
          event.preventDefault();
          return;
        }
        onSave(event);
      }}
      className="mt-5"
    >
      <div
        className="voice-studio"
        data-paused={!voice.active && Boolean(voice.message)}
        data-listening={voice.state === 'listening'}
        data-speaking={voice.state === 'listening' && voice.speaking}
      >
        <div className="microphone-stage">
          <SpeechBars />
          <div className="microphone-ring">
            <button
              type="button"
              className="record-button"
              aria-label={buttonLabel}
              aria-pressed={voice.active}
              disabled={
                saving ||
                voice.state === 'unsupported' ||
                voice.state === 'stopping'
              }
              onClick={voice.active ? voice.stop : voice.start}
            >
              <svg
                aria-hidden="true"
                width="68"
                height="68"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <rect x="9" y="2" width="6" height="13" rx="3" />
                <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
              </svg>
            </button>
          </div>
          <SpeechBars />
        </div>
        <p className="listening-clock" aria-label="Listening time">
          {String(Math.floor(seconds / 60)).padStart(2, '0')}:
          {String(seconds % 60).padStart(2, '0')}
        </p>
        <p
          className="mt-2 text-center text-sm text-[var(--muted)]"
          aria-live="polite"
        >
          {statusLabel}
        </p>
        <LiveTranscript
          text={text}
          interim={voice.interim}
          onTextChange={onTextChange}
          readOnly={saving}
          errorId={error ? errorId : undefined}
        />
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="error mt-4 rounded-xl border p-4 text-sm leading-relaxed"
        >
          {error}
        </p>
      )}
      <button
        className="primary mt-5 w-full"
        disabled={disabled || voice.active || !text.trim()}
        type="submit"
      >
        {saving ? (
          'Saving…'
        ) : (
          <>
            Save privately <span aria-hidden="true">→</span>
          </>
        )}
      </button>
    </form>
  );
}
