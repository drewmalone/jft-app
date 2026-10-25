import { useId, type FormEvent } from 'react';
import { LiveTranscript } from './live-transcript';
import { RecordingControls } from './recording/recording-controls';
import { RecordingStatus } from './recording/recording-status';
import { ListeningClock } from './recording/listening-clock';
import { SaveShareButton } from './save-share-button';
import type { ShareCleanup } from '../cleanup/use-share-cleanup';
import { useTranscription } from '../transcription/use-transcription';

type ShareFormProps = {
  text: string;
  cleanup: ShareCleanup;
  disabled: boolean;
  saving: boolean;
  error: string;
  onTextChange: (text: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
};

/** The parent owns the draft and clears it only after a confirmed save. */
export function ShareForm({
  text,
  cleanup,
  disabled,
  saving,
  error,
  onTextChange,
  onSave
}: ShareFormProps) {
  const voice = useTranscription(text, onTextChange, undefined, (value) => {
    void cleanup.run(value);
  });
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  return (
    <form
      onSubmit={(event) => {
        if (voice.active || cleanup.isPending()) {
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
        <RecordingControls
          state={voice.state}
          active={voice.active}
          disabled={saving || cleanup.pending}
          onToggle={() => {
            if (!cleanup.isPending()) {
              if (voice.active) voice.stop();
              else voice.start();
            }
          }}
        />
        <ListeningClock listening={voice.state === 'listening'} />
        <RecordingStatus state={voice.state} message={voice.message} />
        <p className="mt-2 text-center text-xs text-[var(--muted)]">
          Audio is sent to OpenAI while recording. Review your words before
          saving. After Stop, OpenAI adds paragraphs and removes fillers.
        </p>
        <LiveTranscript
          text={text}
          interim={voice.interim}
          onTextChange={onTextChange}
          readOnly={saving}
          errorId={error ? errorId : undefined}
        />
      </div>
      <div className="mt-3 text-sm text-[var(--muted)]" aria-live="polite">
        {cleanup.pending && (
          <p role="status">Tidying your words… You can keep editing.</p>
        )}
        {cleanup.state.status === 'applied' && (
          <div>
            <p>Your text has been tidied. Review it before saving.</p>
            <button
              type="button"
              className="secondary mt-2 w-full"
              disabled={voice.active || saving}
              onClick={cleanup.undo}
            >
              Undo cleanup
            </button>
          </div>
        )}
        {cleanup.state.status === 'failed' && (
          <div>
            <p role="alert">
              Your text could not be tidied. Your original words are still here.
            </p>
            <button
              type="button"
              className="secondary mt-2 w-full"
              disabled={voice.active || saving}
              onClick={() => {
                void cleanup.run(text);
              }}
            >
              Retry cleanup
            </button>
          </div>
        )}
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
      <SaveShareButton
        saving={saving}
        disabled={disabled || voice.active || cleanup.pending || !text.trim()}
      />
    </form>
  );
}
