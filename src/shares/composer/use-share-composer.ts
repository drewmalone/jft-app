import { useEffect, useRef, type FormEvent } from 'react';
import type { CleanupStatus } from '../cleanup/model';
import { useTranscription } from '../transcription/use-transcription';

export interface ShareComposerOptions {
  text: string;
  cleanupStatus: CleanupStatus;
  cleanupEnabled?: boolean;
  /** Synchronous guard covers a request starting before React has rendered pending state. */
  isCleanupPending: () => boolean;
  onCleanup: (text: string) => Promise<void>;
  sessionReady: boolean;
  /** Missing/loading readings block saving without blocking drafting or recording. */
  readingReady?: boolean;
  saving: boolean;
  onTextChange: (text: string) => void;
  onRecordingChange?: (active: boolean) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}

/** Coordinates mounted editor workflows; the parent retains draft/save ownership across views. */
export function useShareComposer({
  text,
  cleanupStatus,
  cleanupEnabled = true,
  isCleanupPending,
  onCleanup,
  sessionReady,
  readingReady = true,
  saving,
  onTextChange,
  onRecordingChange,
  onSave
}: ShareComposerOptions) {
  const voice = useTranscription(text, onTextChange, {
    onStopped: (value) => {
      if (cleanupEnabled) void onCleanup(value);
    }
  });
  useEffect(() => {
    onRecordingChange?.(voice.active);
  }, [voice.active, voice.state, onRecordingChange]);
  const recordingCallback = useRef(onRecordingChange);
  useEffect(() => {
    recordingCallback.current = onRecordingChange;
  }, [onRecordingChange]);
  useEffect(() => () => recordingCallback.current?.(false), []);
  return {
    voice,
    recordingDisabled: !sessionReady || saving || cleanupStatus === 'pending',
    saveDisabled:
      !sessionReady ||
      !readingReady ||
      saving ||
      voice.active ||
      cleanupStatus === 'pending' ||
      !text.trim(),
    retryDisabled: voice.active || saving,
    submit(event: FormEvent<HTMLFormElement>) {
      if (
        !sessionReady ||
        !readingReady ||
        saving ||
        voice.active ||
        isCleanupPending()
      ) {
        event.preventDefault();
        return;
      }
      onSave(event);
    },
    toggleRecording() {
      if (!sessionReady || saving || isCleanupPending()) return;
      if (voice.active) voice.stop();
      else {
        onRecordingChange?.(true);
        voice.start();
      }
    },
    retryCleanup() {
      if (cleanupEnabled && !voice.active && !saving && !isCleanupPending())
        void onCleanup(text);
    }
  };
}
