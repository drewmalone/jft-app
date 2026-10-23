import { useEffect, useId, useState, type FormEvent } from 'react';
import { LiveTranscript } from './live-transcript';
import { useTranscription } from '../transcription/use-transcription';

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
          <div className="speech-bars" aria-hidden="true">
            {[16, 28, 40, 56, 70, 56, 40, 28, 16].map((height, index) => (
              <span
                key={index}
                style={{ height, animationDelay: `${index * 70}ms` }}
              />
            ))}
          </div>
          <div className="microphone-ring">
            <button
              type="button"
              className="record-button"
              aria-label={
                voice.state === 'starting'
                  ? 'Cancel microphone'
                  : voice.state === 'listening'
                    ? 'Stop listening'
                    : voice.state === 'stopping'
                      ? 'Finishing transcription…'
                      : 'Record your share'
              }
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
          <div className="speech-bars" aria-hidden="true">
            {[16, 28, 40, 56, 70, 56, 40, 28, 16].map((height, index) => (
              <span
                key={index}
                style={{ height, animationDelay: `${index * 70}ms` }}
              />
            ))}
          </div>
        </div>
        <p className="listening-clock" aria-label="Listening time">
          {String(Math.floor(seconds / 60)).padStart(2, '0')}:
          {String(seconds % 60).padStart(2, '0')}
        </p>
        <p
          className="mt-2 text-center text-sm text-[var(--muted)]"
          aria-live="polite"
        >
          {voice.state === 'unsupported'
            ? 'Voice transcription is not available in this browser. You can still type your share.'
            : voice.state === 'starting'
              ? 'Waiting for microphone access…'
              : voice.state === 'listening'
                ? 'Listening… Tap the microphone to pause.'
                : voice.state === 'stopping'
                  ? 'Finishing your words…'
                  : voice.message ||
                    'Tap the microphone to begin, or type below.'}
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
