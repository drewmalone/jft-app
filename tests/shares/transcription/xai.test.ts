import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createXaiSpeech,
  type XaiDependencies
} from '../../../src/shares/transcription/providers/xai/engine';
import { issueXaiSession } from '../../../src/shares/server/providers/xai/session';
import {
  signRelayTicket,
  verifyRelayTicket
} from '../../../services/xai-relay/ticket.mjs';
import { xaiSessionSchema } from '../../../src/shares/transcription/providers/xai/session';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  relaySigningSecret,
  parseRelaySecretArn
} from '../../../src/shares/server/providers/xai/relay-secret';

const secret = 'fictional-relay-signing-key-at-least-32-bytes';
const url = 'wss://relay.example/stt';
const origin = 'https://doorknob.example';
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test('relay issuance exposes only an expiring ticket and requires secure configuration', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    STT_XAI_RELAY_URL: url,
    STT_XAI_RELAY_SECRET: secret,
    STT_XAI_RELAY_SECRET_ARN: ''
  });
  const session = await issueXaiSession(origin);
  assert.equal(session.provider, 'xai');
  assert.equal(session.relay_url, url);
  assert.ok(!JSON.stringify(session).includes(secret));
  assert.equal(
    verifyRelayTicket(session.value, secret, url, origin).origin,
    origin
  );
  assert.ok(xaiSessionSchema.safeParse(session).success);
  for (const configured of [
    '',
    'https://relay.example/stt',
    'wss://key@relay.example/stt',
    'wss://relay.example/stt?key=private'
  ]) {
    process.env.STT_XAI_RELAY_URL = configured;
    await assert.rejects(issueXaiSession(origin));
  }
  process.env.STT_XAI_RELAY_URL = url;
  process.env.STT_XAI_RELAY_SECRET = '';
  await assert.rejects(issueXaiSession(origin), /RELAY_SECRET/);
});

test('relay tickets reject tampering, expiry, wrong origin and wrong audience', () => {
  const now = 100_000;
  const ticket = signRelayTicket(secret, url, origin, now);
  assert.equal(
    verifyRelayTicket(ticket.value, secret, url, origin, now).exp,
    160
  );
  for (const [token, aud, from, time] of [
    [ticket.value + 'x', url, origin, now],
    [ticket.value, 'wss://foreign.example/stt', origin, now],
    [ticket.value, url, 'https://foreign.example', now],
    [ticket.value, url, origin, now + 60_000]
  ] as const)
    assert.throws(() => verifyRelayTicket(token, secret, aud, from, time));
});

test('Amplify signing-secret reads cache successes and recover after safe failures', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    STT_XAI_RELAY_SECRET: '',
    STT_XAI_RELAY_SECRET_ARN:
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:fictional-relay'
  });
  let calls = 0;
  const send = t.mock.method(
    SecretsManagerClient.prototype,
    'send',
    async () => {
      calls++;
      return { SecretString: secret };
    }
  );
  assert.equal(await relaySigningSecret(), secret);
  assert.equal(await relaySigningSecret(), secret);
  assert.equal(calls, 1);
  process.env.STT_XAI_RELAY_SECRET_ARN += '-recover';
  send.mock.mockImplementation(async () => {
    throw new Error('private IAM details');
  });
  await assert.rejects(relaySigningSecret(), {
    message: 'Relay signing secret unavailable'
  });
  send.mock.mockImplementation(async () => ({ SecretString: secret }));
  assert.equal(await relaySigningSecret(), secret);
});

test('AWS ARN parsing accepts Secrets Manager partitions and rejects unrelated or incomplete resources safely', () => {
  for (const [partition, region] of [
    ['aws', 'us-east-1'],
    ['aws-us-gov', 'us-gov-west-1'],
    ['aws-cn', 'cn-north-1']
  ]) {
    const arn = `arn:${partition}:secretsmanager:${region}:123456789012:secret:fictional-signing-key`;
    assert.deepEqual(parseRelaySecretArn(arn), { arn, region });
  }
  for (const arn of [
    undefined,
    '',
    'private-malformed-input',
    'arn:aws:s3:us-east-1:123456789012:secret:wrong-service',
    'arn:aws:secretsmanager::123456789012:secret:missing-region',
    'arn:aws:secretsmanager:us-east-1::secret:missing-account',
    'arn:aws:secretsmanager:us-east-1:123456789012:key:wrong-resource',
    'arn:aws:secretsmanager:us-east-1:123456789012:secret:'
  ]) {
    assert.throws(() => parseRelaySecretArn(arn), {
      message: 'STT_XAI_RELAY_SECRET_ARN must name a Secrets Manager secret'
    });
  }
});

test('an interruption retains locked chunks once and discards only unlocked provisional text', async () => {
  const s = setup();
  await s.open();
  s.message({ type: 'final', text: 'Locked words.' });
  s.message({ type: 'interim', text: 'Unfinished thought' });
  s.socket.onclose?.(new Event('close') as CloseEvent);
  assert.deepEqual(s.finals, ['Locked words.']);
  assert.equal(s.errors.length, 1);
  s.engine.dispose();
  assert.deepEqual(s.finals, ['Locked words.']);
});

function setup(overrides: Partial<XaiDependencies> = {}) {
  let tracksStopped = 0,
    released = 0,
    captureStops = 0,
    listening = 0,
    ended = 0,
    connecting = 0;
  const finals: string[] = [],
    errors: string[] = [],
    sent: (string | ArrayBuffer)[] = [];
  const track = {
    stop: () => tracksStopped++,
    onended: null as (() => void) | null
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (value: string | ArrayBuffer) => sent.push(value),
    close: () => {}
  } as unknown as WebSocket;
  let frame!: (value: ArrayBuffer) => void;
  let flush!: () => void;
  let requestHeaders: Headers | undefined;
  const capture = {
    start: async (_stream: MediaStream, send: (value: ArrayBuffer) => void) => {
      frame = send;
    },
    stop: () => {
      captureStops++;
      return new Promise<void>((resolve) => {
        flush = resolve;
      });
    },
    dispose: () => {
      released++;
    }
  };
  const engine = createXaiSpeech({
    available: () => true,
    microphone: async () => stream,
    capture: () => capture,
    socket: () => socket,
    fetch: async (_url, init) => {
      requestHeaders = new Headers(init?.headers);
      return Response.json({
        provider: 'xai',
        relay_url: url,
        ...signRelayTicket(secret, url, origin)
      });
    },
    ...overrides
  });
  const events = {
    connecting: () => {
      connecting++;
    },
    listening: () => {
      listening++;
    },
    interim: () => {},
    final: (v: string) => {
      finals.push(v);
    },
    error: (v: string) => {
      errors.push(v);
    },
    ended: () => {
      ended++;
    }
  };
  const message = (value: unknown) =>
    socket.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  return {
    engine,
    events,
    stream,
    socket,
    track,
    sent,
    finals,
    errors,
    message,
    async open() {
      engine.start(events);
      await settle();
      socket.onopen?.(new Event('open'));
      message({ type: 'ready' });
      await settle();
    },
    frame: (value = new ArrayBuffer(9600)) => frame(value),
    flush: () => flush(),
    counts: () => ({
      tracksStopped,
      released,
      captureStops,
      listening,
      ended,
      connecting
    }),
    headers: () => requestHeaders
  };
}

test('listening waits for provider readiness and PCM startup; Stop flushes audio before requesting completion', async () => {
  const s = setup();
  s.engine.start(s.events);
  await settle();
  assert.equal(s.counts().connecting, 1);
  assert.equal(s.counts().listening, 0);
  s.socket.onopen?.(new Event('open'));
  assert.match(String(s.sent[0]), /authenticate/);
  assert.equal(s.headers()?.get('x-stt-provider'), 'xai');
  s.message({ type: 'ready' });
  await settle();
  assert.equal(s.counts().listening, 1);
  s.frame();
  s.engine.stop();
  s.engine.stop();
  assert.equal(s.counts().tracksStopped, 1);
  assert.equal(s.counts().captureStops, 1);
  assert.equal(s.counts().ended, 0);
  assert.equal(s.sent.length, 2);
  s.frame(new ArrayBuffer(128)); // Worklet's final short frame.
  s.flush();
  await settle();
  assert.equal(s.sent.at(-1), '{"type":"stop"}');
  s.message({ type: 'final', text: 'Trailing phrase.' });
  assert.equal(s.counts().ended, 0); // A final text event is not Stop completion.
  s.message({ type: 'ended', text: 'Trailing phrase.', duration: 1 });
  assert.deepEqual(s.finals, ['Trailing phrase.']);
  assert.equal(s.counts().ended, 1);
});

test('Stop during silence ends only on done; finalization timeout preserves emitted finals', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const silent = setup();
  await silent.open();
  silent.engine.stop();
  silent.flush();
  await settle();
  silent.message({ type: 'ended', text: '', duration: 1 });
  assert.equal(silent.counts().ended, 1);
  assert.deepEqual(silent.errors, []);
  const s = setup();
  await s.open();
  s.message({ type: 'final', text: 'Keep this.' });
  s.engine.stop();
  s.flush();
  await settle();
  t.mock.timers.tick(5_000);
  assert.match(s.errors[0], /timed out/);
  assert.deepEqual(s.finals, ['Keep this.']);
});

test('Stop during microphone acquisition and disposal silence late asynchronous completions', async () => {
  let grant!: (value: MediaStream) => void;
  const s = setup({
    microphone: () =>
      new Promise((resolve) => {
        grant = resolve;
      })
  });
  s.engine.start(s.events);
  s.engine.stop();
  grant(s.stream);
  await settle();
  assert.equal(s.counts().tracksStopped, 1);
  assert.equal(s.counts().ended, 1);
  assert.equal(s.counts().listening, 0);
  assert.deepEqual(s.sent, []);
  const live = setup();
  await live.open();
  const stale = live.socket.onmessage;
  live.engine.dispose();
  live.engine.dispose();
  live.engine.start(live.events);
  stale?.call(live.socket, {
    data: JSON.stringify({ type: 'final', text: 'Must not appear.' })
  } as MessageEvent);
  assert.deepEqual(live.finals, []);
  assert.equal(live.counts().tracksStopped, 1);
  assert.equal(live.counts().ended, 0);
});

test('disconnects, provider errors, malformed events and backpressure retain finalized text and clean capture', async () => {
  for (const failure of ['close', 'error', 'malformed', 'backpressure']) {
    const s = setup();
    await s.open();
    s.message({ type: 'final', text: 'Keep this.' });
    if (failure === 'close')
      s.socket.onclose?.(new Event('close') as CloseEvent);
    if (failure === 'error')
      s.message({ type: 'error', message: 'private upstream message' });
    if (failure === 'malformed')
      s.socket.onmessage?.({ data: '{private' } as MessageEvent);
    if (failure === 'backpressure') {
      Object.assign(s.socket, { bufferedAmount: 192_001 });
      s.frame();
    }
    assert.deepEqual(s.finals, ['Keep this.']);
    assert.equal(s.errors.length, 1);
    assert.ok(!s.errors[0].includes('private'));
    assert.equal(s.counts().tracksStopped, 1);
    assert.equal(s.socket.onmessage, null);
  }
});

test('credential mismatch never opens transport; cancellation during PCM startup never listens', async () => {
  let sockets = 0;
  const wrong = setup({
    fetch: async () =>
      Response.json({ value: 'openai-token', expires_at: 123 }),
    socket: () => {
      sockets++;
      throw new Error();
    }
  });
  wrong.engine.start(wrong.events);
  await settle();
  assert.equal(sockets, 0);
  assert.equal(wrong.counts().tracksStopped, 1);
  assert.equal(wrong.errors.length, 1);
  let started!: () => void;
  const s = setup({
    capture: () => ({
      start: () =>
        new Promise<void>((resolve) => {
          started = resolve;
        }),
      stop: async () => {},
      dispose: () => {}
    })
  });
  s.engine.start(s.events);
  await settle();
  s.socket.onopen?.(new Event('open'));
  s.message({ type: 'ready' });
  s.engine.stop();
  started();
  await settle();
  assert.equal(s.counts().listening, 0);
  assert.equal(s.counts().ended, 1);
});

test('startup timeout stops capture and ignores late tickets, while denied microphones show safe recovery', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let issue!: (value: Response) => void;
  const s = setup({
    fetch: () =>
      new Promise((resolve) => {
        issue = resolve;
      })
  });
  s.engine.start(s.events);
  await settle();
  t.mock.timers.tick(20_000);
  assert.equal(s.counts().tracksStopped, 1);
  assert.match(s.errors[0], /timed out/);
  issue(
    Response.json({
      provider: 'xai',
      relay_url: url,
      value: 'late-ticket',
      expires_at: 123
    })
  );
  await settle();
  assert.deepEqual(s.sent, []);
  const denied = setup({
    microphone: async () => {
      throw new DOMException('private microphone details', 'NotAllowedError');
    }
  });
  denied.engine.start(denied.events);
  await settle();
  assert.match(denied.errors[0], /access was denied/);
  assert.ok(!denied.errors[0].includes('private'));
});
