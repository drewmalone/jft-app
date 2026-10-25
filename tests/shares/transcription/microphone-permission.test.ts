import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  createMicrophonePermission,
  MICROPHONE_DENIED
} from '../../../src/shares/transcription/microphone-permission';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator'
);
afterEach(() => {
  for (const [name, descriptor] of [
    ['window', originalWindow],
    ['navigator', originalNavigator]
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});
function browser(
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<unknown>,
  secure = true
) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { isSecureContext: secure }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: getUserMedia ? { getUserMedia } : undefined }
  });
}
function stream() {
  const stopped = [0, 0];
  return {
    stopped,
    getTracks: () =>
      stopped.map((_, index) => ({
        stop() {
          stopped[index]++;
        }
      }))
  };
}

test('requests only on demand, stops every track before resolving, and reuses a grant', async () => {
  let calls = 0;
  const audio = stream();
  browser(async (constraints) => {
    assert.deepEqual(constraints, { audio: true });
    calls++;
    return audio;
  });
  const permission = createMicrophonePermission();
  assert.equal(calls, 0);
  const first = permission.request();
  assert.equal(calls, 1); // No await before the browser permission request.
  assert.equal(permission.request(), first);
  await first;
  assert.deepEqual(audio.stopped, [1, 1]);
  assert.equal(permission.request(), undefined); // Subsequent start can remain synchronous.
  assert.equal(calls, 1);
  permission.reset();
  await permission.request();
  assert.equal(calls, 2);
});

test('a previous browser grant resolves without needing the Permissions API', async () => {
  const audio = stream();
  browser(async () => audio);
  await createMicrophonePermission().request();
  assert.deepEqual(audio.stopped, [1, 1]);
});

for (const code of [
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'NotSupportedError',
  'SecurityError',
  'private details'
]) {
  test(`normalizes microphone rejection ${code}`, async () => {
    browser(async () => {
      throw { name: code, message: 'private browser content' };
    });
    await assert.rejects(
      async () => createMicrophonePermission().request(),
      (error: Error) => {
        assert.doesNotMatch(error.message, /private/);
        if (code === 'NotAllowedError')
          assert.equal(error.message, MICROPHONE_DENIED);
        else assert.doesNotMatch(error.message, /was denied/);
        return true;
      }
    );
  });
}

test('unsupported and insecure contexts fail gracefully without capture', () => {
  browser();
  assert.throws(
    () => createMicrophonePermission().request(),
    /cannot request microphone/
  );
  let calls = 0;
  browser(async () => {
    calls++;
    return stream();
  }, false);
  assert.throws(() => createMicrophonePermission().request(), /HTTPS/);
  assert.equal(calls, 0);
});

test('reset while permission is pending still stops late tracks and invalidates the grant', async () => {
  let resolve!: (value: unknown) => void;
  let calls = 0;
  browser(() => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const permission = createMicrophonePermission();
  const request = permission.request();
  permission.reset();
  const audio = stream();
  resolve(audio);
  await request;
  assert.deepEqual(audio.stopped, [1, 1]);
  const next = permission.request();
  assert.equal(calls, 2);
  resolve(stream());
  await next;
});

test('a failing stop does not prevent releasing remaining tracks', async () => {
  let stopped = false;
  browser(async () => ({
    getTracks: () => [
      {
        stop() {
          throw new Error('already stopped');
        }
      },
      {
        stop() {
          stopped = true;
        }
      }
    ]
  }));
  await createMicrophonePermission().request();
  assert.equal(stopped, true);
});

test('a synchronous capture exception receives the same safe handling', () => {
  browser(() => {
    throw new DOMException('private', 'NotAllowedError');
  });
  assert.throws(() => createMicrophonePermission().request(), {
    message: MICROPHONE_DENIED
  });
});
