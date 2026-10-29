import type { TranscriptionEngine, TranscriptionEvents } from '../../types';
import {
  requestMicrophone,
  microphoneErrorCode,
  microphoneErrorMessage
} from '../../microphone-permission';
import { xaiSessionSchema } from './session';
import { createPcmCapture, type PcmCapture } from './audio';
import { relayEventSchema } from './relay';
import { xaiConfig } from './config';

const FAILURE =
  'Speech recognition could not continue. Your finalized words are still here. Please try again.';
type Phase =
  'idle' | 'acquiring' | 'connecting' | 'listening' | 'finalizing' | 'closed';

/** Browser boundaries for deterministic capture and transport cancellation tests. */
export interface XaiDependencies {
  available(): boolean;
  microphone(): Promise<MediaStream>;
  capture(): PcmCapture;
  socket(url: string): WebSocket;
  fetch: typeof fetch;
}
const browser: XaiDependencies = {
  available: () =>
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.AudioContext === 'function' &&
    typeof window.AudioWorkletNode === 'function' &&
    typeof window.WebSocket === 'function',
  microphone: requestMicrophone,
  capture: createPcmCapture,
  socket: (url) => new WebSocket(url),
  fetch: (...args) => fetch(...args)
};

/** One capture session. The relay, rather than the browser, owns xAI event semantics. */
export function createXaiSpeech(
  deps: XaiDependencies = browser
): TranscriptionEngine {
  let phase: Phase = 'idle';
  let events: TranscriptionEvents | undefined;
  let stream: MediaStream | undefined;
  let capture: PcmCapture | undefined;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let readyReceived = false;
  const abort = new AbortController();
  const live = () => phase !== 'idle' && phase !== 'closed';
  const visibility = () => {
    if (document.visibilityState === 'hidden') interrupted();
  };

  function deadline(callback: () => void, ms: number) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (live()) callback();
    }, ms);
  }
  function stopTracks() {
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream = undefined;
  }
  function dispose() {
    if (phase === 'closed') return;
    phase = 'closed';
    events = undefined;
    abort.abort();
    clearTimeout(timer);
    stopTracks();
    capture?.dispose();
    capture = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
      socket = undefined;
    }
    if (typeof window !== 'undefined')
      window.removeEventListener('pagehide', interrupted);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', visibility);
  }
  function finish(error?: string) {
    if (!live()) return;
    const callbacks = events;
    dispose();
    if (error) callbacks?.error(error);
    else callbacks?.ended();
  }
  function interrupted() {
    finish(
      'Recording was interrupted. Your finalized words are still here. Tap to record again.'
    );
  }
  function send(value: string | ArrayBuffer) {
    if (!live()) return;
    try {
      if (
        socket?.readyState !== 1 ||
        socket.bufferedAmount > xaiConfig.maxBufferedBytes
      )
        throw new Error('Transport stalled');
      socket.send(value);
    } catch {
      finish(FAILURE);
    }
  }
  function stop() {
    if (!live() || phase === 'finalizing') return;
    const listening = phase === 'listening';
    phase = 'finalizing';
    stopTracks();
    events?.activity?.(false);
    if (!live()) return;
    if (!listening) {
      finish();
      return;
    }
    deadline(
      () =>
        finish(
          'Finalization timed out. Your finalized words are still here; review before saving.'
        ),
      xaiConfig.finalTimeoutMs
    );
    void capture!
      .stop()
      .then(() => {
        if (live()) {
          capture?.dispose();
          send(JSON.stringify({ type: 'stop' }));
        }
      })
      .catch(() => finish(FAILURE));
  }
  async function session() {
    const response = await deps.fetch('/api/transcription/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stt-provider': 'xai' },
      body: '{}',
      cache: 'no-store',
      signal: abort.signal
    });
    abort.signal.throwIfAborted();
    if (!response.ok) throw new Error('Session unavailable');
    const result = xaiSessionSchema.parse(await response.json());
    abort.signal.throwIfAborted();
    return result;
  }
  async function ready() {
    try {
      await capture!.start(
        stream!,
        (frame) => {
          if (phase === 'listening' || phase === 'finalizing') send(frame);
        },
        interrupted
      );
      if (!live() || phase !== 'connecting') return;
      phase = 'listening';
      deadline(stop, xaiConfig.maxSessionMs);
      events?.listening();
    } catch {
      finish(FAILURE);
    }
  }
  async function connect() {
    try {
      // Both activation-sensitive operations run within the original recording gesture.
      const microphone = deps.microphone();
      void microphone.then(
        (value) => {
          if (!live()) value.getTracks().forEach((track) => track.stop());
        },
        () => {}
      );
      capture = deps.capture();
      const ticket = session();
      void ticket.catch(() => {});
      const granted = await microphone;
      if (!live()) return;
      stream = granted;
      stream.getTracks().forEach((track) => {
        track.onended = interrupted;
      });
      phase = 'connecting';
      events?.connecting?.();
      if (!live()) return;
      const authorization = await ticket;
      if (!live()) return;
      socket = deps.socket(authorization.relay_url);
      socket.onopen = () =>
        send(
          JSON.stringify({ type: 'authenticate', ticket: authorization.value })
        );
      socket.onerror = socket.onclose = () => finish(FAILURE);
      socket.onmessage = (event: MessageEvent<unknown>) => {
        if (!live()) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > 65_536)
            throw new Error('Invalid frame');
          const value = relayEventSchema.parse(JSON.parse(event.data));
          if (value.type === 'ready') {
            if (readyReceived) throw new Error('Duplicate readiness');
            readyReceived = true;
            void ready();
          } else {
            if (!readyReceived) throw new Error('Transcript before readiness');
            if (value.type === 'interim') events?.interim(value.text);
            else if (value.type === 'final') events?.final(value.text);
            else if (value.type === 'error') finish(FAILURE);
            else if (phase === 'finalizing') finish();
            else throw new Error('Unexpected completion');
          }
        } catch {
          finish(FAILURE);
        }
      };
    } catch (cause) {
      if (live())
        finish(
          phase === 'acquiring'
            ? microphoneErrorMessage(microphoneErrorCode(cause))
            : 'Transcription is unavailable. You can still type and save your share.'
        );
    }
  }
  return {
    available: deps.available,
    dispose,
    stop,
    start(callbacks) {
      if (phase !== 'idle') return;
      phase = 'acquiring';
      events = callbacks;
      deadline(
        () =>
          finish(
            'Microphone or transcription connection timed out. Please try again.'
          ),
        xaiConfig.startTimeoutMs
      );
      if (typeof window !== 'undefined')
        window.addEventListener('pagehide', interrupted);
      if (typeof document !== 'undefined')
        document.addEventListener('visibilitychange', visibility);
      void connect();
    }
  };
}
