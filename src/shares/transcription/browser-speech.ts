import type { TranscriptionEngine, TranscriptionEvents } from './types';

type Result = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: { resultIndex: number; results: ArrayLike<Result> }) => void)
    | null;
  start(): void;
  stop(): void;
  abort(): void;
};
/** Structural browser types also permit deterministic mocks without a microphone. */
export type SpeechConstructor = new () => Recognition;

function browserConstructor(): SpeechConstructor | undefined {
  if (typeof window === 'undefined') return;
  const browser = window as unknown as {
    SpeechRecognition?: SpeechConstructor;
    webkitSpeechRecognition?: SpeechConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

/** Browser-managed recognition may use a vendor service. No audio is captured by the app. */
export function createBrowserSpeech(
  Constructor = browserConstructor(),
  language = typeof navigator === 'undefined'
    ? 'en-US'
    : navigator.language || 'en-US'
): TranscriptionEngine {
  let recognition: Recognition | undefined;
  let live = false;
  let stopRequested = false;
  let callbacks: TranscriptionEvents | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const detach = () => {
    clearTimeout(stopTimer);
    if (!recognition) return;
    recognition.onstart =
      recognition.onend =
      recognition.onerror =
      recognition.onresult =
        null;
  };
  return {
    available: () => Boolean(Constructor),
    start(events: TranscriptionEvents) {
      if (!Constructor || recognition) return;
      callbacks = events;
      live = true;
      const seen = new Set<number>();
      try {
        recognition = new Constructor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = language;
        recognition.onstart = () => {
          if (live && !stopRequested) events.listening();
        };
        recognition.onresult = (event) => {
          if (!live) return;
          let interim = '';
          for (let i = 0; live && i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              if (!seen.has(i)) {
                seen.add(i);
                events.final(result[0].transcript);
              }
            } else interim += `${result[0].transcript} `;
          }
          if (live) events.interim(interim.trim());
        };
        recognition.onerror = (event) => {
          if (!live) return;
          live = false;
          detach();
          try {
            recognition?.abort();
          } catch {
            /* Already ended. */
          }
          events.error(
            event.error === 'not-allowed' ||
              event.error === 'service-not-allowed'
              ? 'Microphone access was denied. Allow access in your browser settings, or keep typing.'
              : 'Speech recognition could not continue. Check your connection and try again, or keep typing.'
          );
        };
        recognition.onend = () => {
          if (!live) return;
          live = false;
          detach();
          events.ended();
        };
        recognition.start();
      } catch {
        live = false;
        detach();
        try {
          recognition?.abort();
        } catch {
          /* No active microphone. */
        }
        events.error(
          'Speech recognition could not start. Please try again, or keep typing.'
        );
      }
    },
    stop() {
      if (!live) return;
      if (stopRequested) return;
      stopRequested = true;
      stopTimer = setTimeout(() => {
        if (!live) return;
        live = false;
        detach();
        try {
          recognition?.abort();
        } catch {
          /* Already ended. */
        }
        callbacks?.ended();
      }, 5000);
      try {
        recognition?.stop();
      } catch {
        live = false;
        detach();
        try {
          recognition?.abort();
        } catch {
          /* Already ended. */
        }
        callbacks?.ended();
      }
    },
    dispose() {
      live = false;
      detach();
      try {
        recognition?.abort();
      } catch {
        /* Already ended. */
      }
    }
  };
}
