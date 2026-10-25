import type { FormEvent } from 'react';
import type { ShareCleanup } from '../cleanup/use-share-cleanup';
import { useTranscription } from '../transcription/use-transcription';

export interface ShareComposerOptions {
  text: string;
  cleanup: ShareCleanup;
  disabled: boolean;
  saving: boolean;
  onTextChange: (text: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}

/** Coordinates mounted editor workflows; the parent retains draft/save ownership across views. */
export function useShareComposer({
  text,
  cleanup,
  disabled,
  saving,
  onTextChange,
  onSave
}: ShareComposerOptions) {
  const voice = useTranscription(text, onTextChange, {
    onStopped: (value) => {
      void cleanup.run(value);
    }
  });
  return {
    voice,
    recordingDisabled: disabled || saving || cleanup.pending,
    saveDisabled:
      disabled || saving || voice.active || cleanup.pending || !text.trim(),
    retryDisabled: voice.active || saving,
    submit(event: FormEvent<HTMLFormElement>) {
      if (disabled || saving || voice.active || cleanup.isPending()) {
        event.preventDefault();
        return;
      }
      onSave(event);
    },
    toggleRecording() {
      if (disabled || saving || cleanup.isPending()) return;
      if (voice.active) voice.stop();
      else voice.start();
    },
    retryCleanup() {
      if (!voice.active && !saving && !cleanup.isPending())
        void cleanup.run(text);
    }
  };
}
