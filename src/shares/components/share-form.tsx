import { useId, type FormEvent } from 'react';
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
      <div className="mb-6">
        <button
          type="button"
          className="primary w-full"
          disabled={
            saving ||
            voice.state === 'unsupported' ||
            voice.state === 'stopping'
          }
          onClick={voice.active ? voice.stop : voice.start}
        >
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <rect x="9" y="2" width="6" height="13" rx="3" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
          </svg>
          {voice.state === 'starting'
            ? 'Cancel microphone'
            : voice.state === 'listening'
              ? 'Stop listening'
              : voice.state === 'stopping'
                ? 'Finishing transcription…'
                : 'Record your share'}
        </button>
        <p className="mt-3 text-sm text-[var(--muted)]" aria-live="polite">
          {voice.state === 'unsupported'
            ? 'Voice transcription is not available in this browser. You can still type your share.'
            : voice.state === 'starting'
              ? 'Waiting for microphone access…'
              : voice.state === 'listening'
                ? 'Listening… Speak from your own experience.'
                : voice.state === 'stopping'
                  ? 'Finishing your words…'
                  : voice.message ||
                    'Speak or type. Your words belong to one share.'}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          Speech recognition is provided by your browser and may use an online
          service. Review your words before saving. Doorknob does not record or
          store audio; only text you choose to save is sent to Doorknob.
        </p>
      </div>
      <label htmlFor={fieldId} className="sr-only">
        Your thoughts about today&apos;s reading
      </label>
      <textarea
        id={fieldId}
        aria-describedby={error ? errorId : undefined}
        value={text}
        readOnly={saving}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="Start writing…"
        className="share-textarea"
      />
      {voice.interim && (
        <p
          className="mt-3 text-sm italic text-[var(--muted)]"
          aria-live="polite"
        >
          <span className="font-semibold">Still recognizing: </span>
          {voice.interim}
        </p>
      )}
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
