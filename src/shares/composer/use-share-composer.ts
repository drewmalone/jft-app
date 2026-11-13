import { useEffect, useRef, type FormEvent } from 'react';
import { useTranscription } from '../transcription/use-transcription';

export interface ShareComposerOptions {
  text: string;
  sessionReady: boolean;
  /** Missing/loading readings block saving without blocking drafting or recording. */
  readingReady?: boolean;
  saving: boolean;
  onTextChange: (text: string) => void;
  onRecordingChange?: (active: boolean) => void;
  onPreparingChange?: (active: boolean) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}

/** Coordinates mounted editor workflows; the parent retains draft/save ownership across views. */
export function useShareComposer({
  text,
  sessionReady,
  readingReady = true,
  saving,
  onTextChange,
  onRecordingChange,
  onPreparingChange,
  onSave
}: ShareComposerOptions) {
  const pendingSave = useRef<HTMLFormElement | null>(null);
  const voice = useTranscription(text, onTextChange);
  useEffect(() => {
    onRecordingChange?.(voice.active);
  }, [voice.active, voice.state, onRecordingChange]);
  useEffect(() => {
    if (!pendingSave.current || voice.active) return;
    if (voice.state === 'error' || !sessionReady || !readingReady) {
      pendingSave.current = null;
      onPreparingChange?.(false);
      return;
    }
    const form = pendingSave.current;
    pendingSave.current = null;
    // Keep the recorder mounted until final words have reached the draft.
    if (text.trim()) form.requestSubmit();
    else onPreparingChange?.(false);
  }, [
    voice.active,
    voice.state,
    text,
    sessionReady,
    readingReady,
    onPreparingChange
  ]);
  const recordingCallback = useRef(onRecordingChange);
  useEffect(() => {
    recordingCallback.current = onRecordingChange;
  }, [onRecordingChange]);
  useEffect(() => () => recordingCallback.current?.(false), []);
  return {
    voice,
    recordingDisabled: !sessionReady || saving,
    saveDisabled:
      !sessionReady ||
      !readingReady ||
      saving ||
      voice.state === 'stopping' ||
      (!text.trim() && !voice.active),
    submit(event: FormEvent<HTMLFormElement>) {
      if (!sessionReady || !readingReady || saving || pendingSave.current) {
        event.preventDefault();
        return;
      }
      onPreparingChange?.(true);
      if (voice.active) {
        event.preventDefault();
        pendingSave.current = event.currentTarget;
        voice.stop();
        return;
      }
      onSave(event);
    },
    toggleRecording() {
      if (!sessionReady || saving) return;
      if (voice.active) voice.stop();
      else {
        onRecordingChange?.(true);
        voice.start();
      }
    }
  };
}
