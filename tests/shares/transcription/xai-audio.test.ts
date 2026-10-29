import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPcmCapture } from '../../../src/shares/transcription/providers/xai/audio';

test('PCM capture resumes in the gesture, flushes before releasing, and disconnects every audio resource', async (t) => {
  let resumed = 0,
    closed = 0,
    disconnected = 0,
    portsClosed = 0,
    failures = 0;
  const frames: ArrayBuffer[] = [];
  const sent: string[] = [];
  class Node {
    static current: Node;
    port = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      close: () => {
        portsClosed++;
      },
      postMessage: (value: string) => sent.push(value)
    };
    onprocessorerror: (() => void) | null = null;
    constructor() {
      Node.current = this;
    }
    connect() {}
    disconnect() {
      disconnected++;
    }
  }
  class Context {
    static current: Context;
    state = 'running';
    sampleRate = 48_000;
    destination = {};
    onstatechange: (() => void) | null = null;
    audioWorklet = {
      addModule: async (path: string) =>
        assert.equal(path, '/xai-pcm-worklet.js')
    };
    constructor() {
      Context.current = this;
    }
    createMediaStreamSource() {
      return {
        connect() {},
        disconnect() {
          disconnected++;
        }
      };
    }
    createGain() {
      return {
        gain: { value: 1 },
        connect() {
          assert.equal(this.gain.value, 0);
        },
        disconnect() {
          disconnected++;
        }
      };
    }
    async resume() {
      resumed++;
    }
    async close() {
      closed++;
    }
  }
  for (const [name, value] of [
    ['AudioContext', Context],
    ['AudioWorkletNode', Node]
  ] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => Reflect.deleteProperty(globalThis, name));
  }
  const capture = createPcmCapture();
  assert.equal(resumed, 1);
  await capture.start(
    {} as MediaStream,
    (frame) => frames.push(frame),
    () => {
      failures++;
    }
  );
  const pcm = new ArrayBuffer(100);
  Node.current.port.onmessage?.({ data: pcm } as MessageEvent);
  assert.equal(frames[0], pcm);
  let flushed = false;
  const stop = capture.stop().then(() => {
    flushed = true;
  });
  assert.deepEqual(sent, ['stop']);
  assert.equal(flushed, false);
  Node.current.port.onmessage?.({ data: 'stopped' } as MessageEvent);
  await stop;
  Context.current.state = 'suspended';
  Context.current.onstatechange?.();
  assert.equal(failures, 1);
  capture.dispose();
  capture.dispose();
  assert.equal(disconnected, 3);
  assert.equal(portsClosed, 1);
  assert.equal(closed, 1);
  assert.equal(Node.current.port.onmessage, null);
  assert.equal(Context.current.onstatechange, null);
});

test('disposing during worklet loading prevents late microphone attachment', async (t) => {
  let load!: () => void;
  let attached = 0,
    closed = 0;
  class Context {
    state = 'running';
    sampleRate = 48_000;
    onstatechange = null;
    audioWorklet = {
      addModule: () =>
        new Promise<void>((resolve) => {
          load = resolve;
        })
    };
    createMediaStreamSource() {
      attached++;
      throw new Error('Must not attach');
    }
    async resume() {}
    async close() {
      closed++;
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: Context
  });
  t.after(() => Reflect.deleteProperty(globalThis, 'AudioContext'));
  const capture = createPcmCapture();
  const pending = capture.start(
    {} as MediaStream,
    () => {},
    () => {}
  );
  await Promise.resolve();
  capture.dispose();
  load();
  await pending;
  assert.equal(attached, 0);
  assert.equal(closed, 1);
});
