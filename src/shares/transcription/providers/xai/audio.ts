import { relayAudio } from '../../../../../shared/xai-relay/contract.mjs';

/** Created synchronously in the recording gesture so Safari can resume its AudioContext. */
export function createPcmCapture() {
  const context = new AudioContext({ sampleRate: relayAudio.sampleRate });
  const resumed = context.resume();
  void resumed.catch(() => {});
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let mute: GainNode | undefined;
  let closed = false;
  let stopping: (() => void) | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    clearTimeout(flushTimer);
    stopping?.();
    stopping = undefined;
    context.onstatechange = null;
    if (node) {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      node.port.close();
      node.disconnect();
    }
    source?.disconnect();
    mute?.disconnect();
    void context.close().catch(() => {});
  };
  return {
    /** Attach only after transcript.created. Audio produced before readiness is not buffered. */
    async start(
      stream: MediaStream,
      frame: (value: ArrayBuffer) => void,
      failed: () => void
    ) {
      await resumed;
      if (closed) return;
      if (
        context.state !== 'running' ||
        context.sampleRate !== relayAudio.sampleRate
      )
        throw new Error('Audio unavailable');
      await context.audioWorklet.addModule('/xai-pcm-worklet.js');
      if (closed) return;
      node = new AudioWorkletNode(context, 'doorknob-pcm', {
        processorOptions: { samplesPerFrame: relayAudio.samplesPerFrame }
      });
      node.onprocessorerror = failed;
      context.onstatechange = () => {
        if (!closed && context.state !== 'running') failed();
      };
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (closed) return;
        if (event.data === 'stopped') {
          clearTimeout(flushTimer);
          stopping?.();
          stopping = undefined;
        } else if (event.data instanceof ArrayBuffer) frame(event.data);
        else failed();
      };
      source = context.createMediaStreamSource(stream);
      mute = context.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(context.destination);
    },
    /** Flush the worklet before audio.done; callers stop microphone tracks synchronously first. */
    stop(): Promise<void> {
      if (closed || !node) return Promise.resolve();
      return new Promise((resolve, reject) => {
        stopping = resolve;
        flushTimer = setTimeout(() => {
          stopping = undefined;
          reject(new Error('Audio flush timed out'));
        }, 1_000);
        node!.port.postMessage('stop');
      });
    },
    dispose
  };
}

export type PcmCapture = ReturnType<typeof createPcmCapture>;
