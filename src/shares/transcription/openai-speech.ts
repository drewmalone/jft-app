import type { TranscriptionEngine, TranscriptionEvents } from './types';
import { createOpenAIResults } from './openai-results';
import {
  connectOpenAI,
  requestOpenAICredential,
  TranscriptionUnavailable
} from './openai-connection';
import { watchMicrophone } from './microphone-activity';
import {
  requestMicrophone,
  microphoneErrorCode,
  microphoneErrorMessage
} from './microphone-permission';
import { reportProviderEvent } from './provider-diagnostics';
import { watchWebRTCStats } from './webrtc-diagnostics';
import { speechDiagnostic } from './diagnostics';

const START_TIMEOUT_MS = 20_000;
const FINAL_TIMEOUT_MS = 5_000;
const AUDIO_DRAIN_MS = 300;
const MAX_SESSION_MS = 10 * 60_000;
const FAILURE =
  'Speech recognition could not continue. Your finalized words are still here. Please try again.';

/** Browser boundaries are injected in tests; provider transport stays outside the editor. */
export interface SpeechDependencies {
  available(): boolean;
  microphone(): Promise<MediaStream>;
  peer(): RTCPeerConnection;
  fetch: typeof fetch;
  watch: typeof watchMicrophone;
}
const browser: SpeechDependencies = {
  available: () =>
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    Boolean(
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof window.RTCPeerConnection === 'function' &&
      typeof window.AudioContext === 'function'
    ),
  microphone: requestMicrophone,
  peer: () => new RTCPeerConnection(),
  fetch: (...args) => fetch(...args),
  watch: watchMicrophone
};

/** One explicitly started OpenAI WebRTC session. Disposal cancels and silences all pending work. */
export function createOpenAISpeech(deps = browser): TranscriptionEngine {
  let used = false;
  let live = false;
  let stopping = false;
  let ready = false;
  let drained = false;
  let requested = 0;
  let stream: MediaStream | undefined;
  let peer: RTCPeerConnection | undefined;
  let channel: RTCDataChannel | undefined;
  let unwatch: (() => void) | undefined;
  let unwatchStats: (() => void) | undefined;
  let events: TranscriptionEvents;
  let results: ReturnType<typeof createOpenAIResults>;
  const abort = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (callback: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (live) callback();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const stopMicrophone = () => {
    unwatch?.();
    unwatch = undefined;
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream = undefined;
  };
  const release = () => {
    live = false;
    abort.abort();
    timers.forEach(clearTimeout);
    timers.clear();
    stopMicrophone();
    unwatchStats?.();
    unwatchStats = undefined;
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', visibility);
    if (typeof window !== 'undefined')
      window.removeEventListener('pagehide', interrupted);
    if (channel) {
      channel.onopen =
        channel.onmessage =
        channel.onerror =
        channel.onclose =
          null;
      channel.close();
      channel = undefined;
    }
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.close();
      peer = undefined;
    }
    speechDiagnostic('dispose');
  };
  const finish = (error?: string) => {
    if (!live) return;
    release();
    if (error) {
      speechDiagnostic('recognition-error', { code: 'provider' });
      events.error(error);
    } else {
      speechDiagnostic('recognition-end');
      events.ended();
    }
  };
  const interrupted = () =>
    finish(
      'Recording was interrupted. Your finalized words are still here. Tap to record again.'
    );
  const visibility = () => {
    if (document.visibilityState === 'hidden') interrupted();
  };
  const commit = () => {
    if (!live || channel?.readyState !== 'open') return;
    requested++;
    speechDiagnostic('audio-turn-commit');
    channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  };
  const maybeFinish = () => {
    if (stopping && drained && requested === 0 && !results.pending()) finish();
  };
  const stop = () => {
    if (!live || stopping) return;
    stopping = true;
    stopMicrophone();
    events.activity?.(false);
    if (!ready) {
      finish();
      return;
    }
    // RTP and data channel delivery are independent; allow the last audio packets to drain.
    later(() => {
      drained = true;
      try {
        commit();
      } catch {
        finish(FAILURE);
      }
    }, AUDIO_DRAIN_MS);
    later(
      () =>
        finish(
          'Finalization timed out. Your finalized words are still here; review before saving.'
        ),
      FINAL_TIMEOUT_MS
    );
  };
  return {
    available() {
      const supported = deps.available();
      speechDiagnostic('availability', { supported });
      return supported;
    },
    start(callbacks) {
      if (used) return;
      used = true;
      const started = performance.now();
      live = true;
      events = callbacks;
      results = createOpenAIResults({
        ...events,
        final: (text) => {
          if (live) {
            speechDiagnostic('final-committed');
            events.final(text);
          }
        },
        interim: (text) => {
          if (live) events.interim(text);
        }
      });
      speechDiagnostic('start-requested');
      const startup = later(
        () =>
          finish(
            'Microphone or transcription connection timed out. Please try again.'
          ),
        START_TIMEOUT_MS
      );
      if (typeof document !== 'undefined')
        document.addEventListener('visibilitychange', visibility);
      if (typeof window !== 'undefined')
        window.addEventListener('pagehide', interrupted);
      void (async () => {
        let acquiring = true;
        try {
          // Begin permission request directly from the user gesture; release late grants after cancellation.
          const microphone = deps.microphone();
          // Permission and credential fetch can overlap; handle early rejection until the microphone resolves.
          const credential = requestOpenAICredential(deps.fetch, abort.signal);
          void credential.catch(() => {});
          const acquired = await microphone;
          acquiring = false;
          if (!live) {
            acquired.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = acquired;
          stream.getTracks().forEach((track) => {
            track.onended = interrupted;
          });
          speechDiagnostic('microphone-permission-granted', {
            elapsedMs: Math.round(performance.now() - started)
          });
          events.connecting?.();
          if (!live) return;
          peer = deps.peer();
          stream.getTracks().forEach((track) => peer!.addTrack(track, stream!));
          peer.onconnectionstatechange = () => {
            if (live)
              speechDiagnostic('webrtc-connection-state', {
                stage: peer!.connectionState
              });
            if (
              live &&
              ['failed', 'disconnected', 'closed'].includes(
                peer!.connectionState
              )
            )
              finish(FAILURE);
          };
          channel = peer.createDataChannel('oai-events');
          const seenEvents = new Set<string>();
          channel.onmessage = (message) => {
            if (!live) return;
            try {
              if (
                typeof message.data !== 'string' ||
                message.data.length > 65_536
              )
                throw new Error('Invalid event');
              const event = JSON.parse(message.data) as Record<string, unknown>;
              if (!event || typeof event.type !== 'string')
                throw new Error('Invalid event');
              if (typeof event.event_id === 'string') {
                if (seenEvents.has(event.event_id)) return;
                seenEvents.add(event.event_id);
                if (seenEvents.size > 20_000)
                  throw new Error('Too many events');
              }
              reportProviderEvent(event);
              if (event.type === 'error') {
                const code = (event.error as { code?: string } | undefined)
                  ?.code;
                if (code === 'input_audio_buffer_commit_empty') {
                  requested = Math.max(0, requested - 1);
                  maybeFinish();
                  return;
                }
                finish(FAILURE);
                return;
              }
              if (
                event.type ===
                'conversation.item.input_audio_transcription.failed'
              ) {
                finish(FAILURE);
                return;
              }
              if (event.type === 'input_audio_buffer.committed')
                requested = Math.max(0, requested - 1);
              results.accept(event);
              speechDiagnostic('results');
              maybeFinish();
            } catch {
              finish(FAILURE);
            }
          };
          channel.onerror = () => {
            speechDiagnostic('data-channel-error');
            finish(FAILURE);
          };
          channel.onclose = () => {
            if (live) {
              speechDiagnostic('data-channel-closed');
              finish(FAILURE);
            }
          };
          channel.onopen = () => {
            if (!live || stopping) return;
            clearTimeout(startup);
            timers.delete(startup);
            ready = true;
            speechDiagnostic('data-channel-open', {
              elapsedMs: Math.round(performance.now() - started)
            });
            unwatchStats = watchWebRTCStats(peer!);
            try {
              unwatch = deps.watch(
                stream!,
                (active) => {
                  if (live && !stopping) {
                    speechDiagnostic('microphone-activity', {
                      speaking: active
                    });
                    events.activity?.(active);
                  }
                },
                () => {
                  if (!stopping) {
                    try {
                      commit();
                    } catch {
                      finish(FAILURE);
                    }
                  }
                },
                interrupted
              );
              if (!live) {
                unwatch();
                unwatch = undefined;
                return;
              }
              speechDiagnostic('recognition-start');
              events.listening();
              later(stop, MAX_SESSION_MS);
            } catch {
              finish(FAILURE);
            }
          };
          await connectOpenAI(peer, deps.fetch, abort.signal, credential);
          speechDiagnostic('start-returned');
        } catch (cause) {
          if (!live) return;
          if (acquiring) {
            const code = microphoneErrorCode(cause);
            speechDiagnostic(
              code === 'NotAllowedError'
                ? 'microphone-permission-denied'
                : 'microphone-permission-failed',
              { code }
            );
            finish(microphoneErrorMessage(code));
          } else {
            finish(
              cause instanceof TranscriptionUnavailable
                ? 'Transcription is unavailable. You can still type and save your share.'
                : FAILURE
            );
          }
        }
      })();
    },
    stop,
    dispose: release
  };
}
