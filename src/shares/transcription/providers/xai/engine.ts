import type { TranscriptionEngine, TranscriptionEvents } from '../../types';
import {
  requestMicrophone,
  microphoneErrorCode,
  microphoneErrorMessage
} from '../../microphone-permission';
import { xaiSessionSchema } from '../../model';
import { createPcmCapture, type PcmCapture } from './audio';
import { createXaiProtocol } from './protocol';
import { xaiConfig } from './config';

const FAILURE =
  'Speech recognition could not continue. Your finalized words are still here. Please try again.';
type Phase =
  'idle' | 'acquiring' | 'connecting' | 'listening' | 'finalizing' | 'closed';

/** Browser boundaries for deterministic transport, capture and cancellation tests. */
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
    Boolean(
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof window.AudioContext === 'function' &&
      typeof window.AudioWorkletNode === 'function' &&
      typeof window.WebSocket === 'function'
    ),
  microphone: requestMicrophone,
  capture: createPcmCapture,
  socket: (url) => new WebSocket(url),
  fetch: (...args) => fetch(...args)
};

/** One live PCM stream through an authenticated external relay, with bounded Stop finalization. */
export class XaiTranscriptionSession implements TranscriptionEngine {
  private phase: Phase = 'idle';
  private events?: TranscriptionEvents;
  private stream?: MediaStream;
  private capture?: PcmCapture;
  private socket?: WebSocket;
  private protocol?: ReturnType<typeof createXaiProtocol>;
  private created = false;
  private readonly abort = new AbortController();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(private readonly deps: XaiDependencies = browser) {}

  available() {
    return this.deps.available();
  }
  private get live() {
    return this.phase !== 'idle' && this.phase !== 'closed';
  }

  start(events: TranscriptionEvents) {
    if (this.phase !== 'idle') return;
    this.phase = 'acquiring';
    this.events = events;
    const startup = this.later(
      () =>
        this.finish(
          'Microphone or transcription connection timed out. Please try again.'
        ),
      xaiConfig.startTimeoutMs
    );
    if (typeof window !== 'undefined')
      window.addEventListener('pagehide', this.interrupted);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', this.visibility);
    void this.connect(startup);
  }

  stop() {
    if (!this.live || this.phase === 'finalizing') return;
    const listening = this.phase === 'listening';
    this.phase = 'finalizing';
    this.stopTracks();
    this.events?.activity?.(false);
    if (!this.live) return;
    if (!listening) {
      this.finish();
      return;
    }
    this.later(
      () =>
        this.finish(
          'Finalization timed out. Your finalized words are still here; review before saving.'
        ),
      xaiConfig.finalTimeoutMs
    );
    void this.capture!.stop()
      .then(() => {
        if (!this.live) return;
        this.capture?.dispose();
        this.send(JSON.stringify({ type: 'audio.done' }));
      })
      .catch(() => {
        if (this.live) this.finish(FAILURE);
      });
  }

  dispose() {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.events = undefined;
    this.abort.abort();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.stopTracks();
    this.capture?.dispose();
    this.capture = undefined;
    this.protocol = undefined;
    if (this.socket) {
      this.socket.onopen =
        this.socket.onmessage =
        this.socket.onerror =
        this.socket.onclose =
          null;
      this.socket.close();
      this.socket = undefined;
    }
    if (typeof window !== 'undefined')
      window.removeEventListener('pagehide', this.interrupted);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.visibility);
  }

  private async connect(startup: ReturnType<typeof setTimeout>) {
    try {
      // Both activation-sensitive operations execute synchronously within start's recording gesture.
      const microphone = this.deps.microphone();
      void microphone.then(
        (stream) => {
          if (!this.live) stream.getTracks().forEach((track) => track.stop());
        },
        () => {}
      );
      this.capture = this.deps.capture();
      const ticket = this.session();
      void ticket.catch(() => {});
      const stream = await microphone;
      if (!this.live) return;
      this.stream = stream;
      stream.getTracks().forEach((track) => {
        track.onended = this.interrupted;
      });
      this.phase = 'connecting';
      this.events?.connecting?.();
      if (!this.live) return;
      const session = await ticket;
      if (!this.live) return;
      const socket = this.deps.socket(session.relay_url);
      this.socket = socket;
      const protocol = createXaiProtocol({
        interim: (text) => {
          if (this.live) this.events?.interim(text);
        },
        final: (text) => {
          if (this.live) this.events?.final(text);
        },
        activity: (active) => {
          if (this.phase === 'listening') this.events?.activity?.(active);
        }
      });
      this.protocol = protocol;
      socket.onopen = () => {
        if (this.live)
          this.send(
            JSON.stringify({ type: 'authenticate', ticket: session.value })
          );
      };
      socket.onerror = socket.onclose = () => {
        if (this.live) this.finish(FAILURE);
      };
      socket.onmessage = (event: MessageEvent<unknown>) => {
        if (!this.live) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > 65_536)
            throw new Error('Invalid frame');
          const value = JSON.parse(event.data);
          if (value.type === 'transcript.created') {
            if (this.created) throw new Error('Duplicate readiness');
            this.created = true;
            void this.ready(stream, startup);
          } else {
            if (!this.created)
              throw new Error('Transcription before readiness');
            const done = protocol.accept(value);
            if (!this.live) return;
            if (done) {
              if (this.phase !== 'finalizing')
                throw new Error('Unexpected completion');
              this.finish();
            }
          }
        } catch {
          this.finish(FAILURE);
        }
      };
    } catch (cause) {
      if (!this.live) return;
      this.finish(
        this.phase === 'acquiring'
          ? microphoneErrorMessage(microphoneErrorCode(cause))
          : 'Transcription is unavailable. You can still type and save your share.'
      );
    }
  }

  private async ready(
    stream: MediaStream,
    startup: ReturnType<typeof setTimeout>
  ) {
    try {
      await this.capture!.start(
        stream,
        (frame) => {
          if (this.phase === 'listening' || this.phase === 'finalizing')
            this.send(frame);
        },
        this.interrupted
      );
      if (!this.live || this.phase !== 'connecting') return;
      clearTimeout(startup);
      this.timers.delete(startup);
      this.phase = 'listening';
      this.events?.listening();
      if (this.live) this.later(() => this.stop(), xaiConfig.maxSessionMs);
    } catch {
      if (this.live) this.finish(FAILURE);
    }
  }

  private async session() {
    const response = await this.deps.fetch('/api/transcription/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stt-provider': 'xai' },
      body: '{}',
      cache: 'no-store',
      signal: this.abort.signal
    });
    this.abort.signal.throwIfAborted();
    if (!response.ok) throw new Error('Session unavailable');
    const result = xaiSessionSchema.parse(await response.json());
    this.abort.signal.throwIfAborted();
    return result;
  }
  private send(value: string | ArrayBuffer) {
    if (!this.live) return;
    try {
      if (
        this.socket?.readyState !== 1 ||
        this.socket.bufferedAmount > xaiConfig.maxBufferedBytes
      )
        throw new Error('Transport stalled');
      this.socket.send(value);
    } catch {
      this.finish(FAILURE);
    }
  }
  private stopTracks() {
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = undefined;
  }
  private finish(error?: string) {
    if (!this.live) return;
    if (error) this.protocol?.retainLocked();
    // Emitting a locked fragment may reach the hook's draft limit and dispose this session.
    if (!this.live) return;
    const events = this.events;
    this.dispose();
    if (error) events?.error(error);
    else events?.ended();
  }
  private readonly interrupted = () =>
    this.finish(
      'Recording was interrupted. Your finalized words are still here. Tap to record again.'
    );
  private readonly visibility = () => {
    if (document.visibilityState === 'hidden') this.interrupted();
  };
  private later(callback: () => void, ms: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.live) callback();
    }, ms);
    this.timers.add(timer);
    return timer;
  }
}

export const createXaiSpeech = (deps?: XaiDependencies): TranscriptionEngine =>
  new XaiTranscriptionSession(deps);
