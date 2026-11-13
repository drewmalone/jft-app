import { useEffect, useId, useRef, useState } from 'react';
import { LiveTranscript } from './live-transcript';
import { RecordingControls } from './recording/recording-controls';
import { RecordingStatus } from './recording/recording-status';
import { ListeningClock, useListeningTime } from './recording/listening-clock';
import { SaveShareButton } from './save-share-button';
import {
  useShareComposer,
  type ShareComposerOptions
} from './use-share-composer';

type ShareFormProps = ShareComposerOptions & {
  error: string;
  onSaveOriginal?: () => void;
};

/** The parent owns the draft and clears it only after a confirmed save. */
export function ShareForm({
  text,
  sessionReady,
  readingReady,
  saving,
  error,
  onSaveOriginal,
  onRecordingChange,
  onPreparingChange,
  onTextChange,
  onSave
}: ShareFormProps) {
  const composer = useShareComposer({
    text,
    sessionReady,
    readingReady,
    saving,
    onRecordingChange,
    onPreparingChange,
    onTextChange,
    onSave
  });
  const { voice } = composer;
  const time = useListeningTime(voice.state === 'listening');
  const panel = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('--recording-dock-height');
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (height)
        root.style.setProperty(
          '--recording-dock-height',
          `${Math.ceil(height)}px`
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (previous) root.style.setProperty('--recording-dock-height', previous);
      else root.style.removeProperty('--recording-dock-height');
    };
  }, []);
  const inlineRecorder = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(true);
  useEffect(() => {
    const target = inlineRecorder.current;
    if (!target) return;
    const mobile = window.matchMedia('(max-width: 767px)');
    let observer: IntersectionObserver | undefined;
    const observe = () => {
      observer?.disconnect();
      if (!mobile.matches) {
        setDocked(false);
        return;
      }
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!mobile.matches) return;
          // Hysteresis keeps small scroll movements from flickering between views.
          setDocked((current) =>
            current
              ? entry.intersectionRatio < 0.98
              : entry.intersectionRatio < 0.75
          );
        },
        { threshold: [0, 0.75, 0.98, 1], rootMargin: '-8px 0px -8px 0px' }
      );
      observer.observe(target);
    };
    observe();
    mobile.addEventListener('change', observe);
    return () => {
      observer?.disconnect();
      mobile.removeEventListener('change', observe);
    };
  }, []);
  const showDock = docked && !editing;
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview.current)
      preview.current.scrollTop = preview.current.scrollHeight;
  }, [text, voice.interim]);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  return (
    <form
      onSubmit={composer.submit}
      className="share-form mt-5"
      onFocusCapture={(event) => {
        if (event.target.tagName === 'TEXTAREA') setEditing(true);
      }}
      onBlurCapture={(event) => {
        if (event.target.tagName !== 'TEXTAREA') return;
        const next = event.relatedTarget;
        // Keep controls stable between pointer-down (blur) and their click.
        if (
          next instanceof HTMLElement &&
          (next.closest('.inline-recorder') || next.matches('button.primary'))
        )
          return;
        setEditing(false);
      }}
    >
      <div
        className="voice-studio"
        data-paused={!voice.active && Boolean(voice.message)}
        data-listening={voice.state === 'listening'}
        data-speaking={voice.state === 'listening' && voice.speaking}
      >
        <div
          ref={inlineRecorder}
          className="inline-recorder"
          inert={showDock}
          aria-hidden={showDock}
        >
          <RecordingControls
            state={voice.state}
            active={voice.active}
            disabled={composer.recordingDisabled}
            onToggle={() => {
              setEditing(false);
              composer.toggleRecording();
            }}
          />
          {!(showDock && voice.state === 'listening') && (
            <ListeningClock time={time} />
          )}
          {!showDock && (
            <RecordingStatus state={voice.state} message={voice.message} />
          )}
        </div>
        <div
          className="recording-panel"
          ref={panel}
          data-visible={showDock}
          inert={!showDock}
          aria-hidden={!showDock}
        >
          <div className="recording-microphone">
            <RecordingControls
              state={voice.state}
              active={voice.active}
              disabled={composer.recordingDisabled}
              onToggle={composer.toggleRecording}
            />
            {showDock && voice.state === 'listening' && (
              <ListeningClock time={time} />
            )}
            {showDock && (
              <RecordingStatus state={voice.state} message={voice.message} />
            )}
          </div>
          <div className="recording-preview-column">
            <p className="eyebrow">Your words</p>
            <div
              ref={preview}
              className="recording-preview"
              role="region"
              aria-label="Latest recognized words"
              aria-live="off"
            >
              {text || (!voice.interim && 'Your words will appear here.')}
              {voice.interim && (
                <span className="transcript-interim"> {voice.interim}</span>
              )}
            </div>
            {(voice.active || Boolean(text.trim())) && (
              <button
                type="submit"
                className="dock-save-button"
                disabled={composer.saveDisabled}
              >
                {saving ? 'Saving…' : 'Save'} <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        </div>
        <div className="transcript-editor">
          <LiveTranscript
            text={text}
            interim={voice.interim}
            onTextChange={onTextChange}
            readOnly={saving}
            errorId={error ? errorId : undefined}
          />
        </div>
      </div>
      {voice.message && voice.message !== 'Tap to record more.' && (
        <p role="alert" className="error mt-4 rounded-xl border p-4 text-sm">
          {voice.message}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          data-save-error
          tabIndex={-1}
          role="alert"
          className="error mt-4 rounded-xl border p-4 text-sm leading-relaxed"
        >
          {error}
        </p>
      )}
      {onSaveOriginal && (
        <button
          type="button"
          className="secondary mt-3 w-full"
          disabled={saving || voice.active}
          onClick={onSaveOriginal}
        >
          Save original words
        </button>
      )}
      <SaveShareButton saving={saving} disabled={composer.saveDisabled} />
    </form>
  );
}
