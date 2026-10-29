import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  bridge,
  createTicketConsumer
} from '../../../services/xai-relay/bridge.mjs';
import { relayConfiguration } from '../../../services/xai-relay/config.mjs';
import { signRelayTicket } from '../../../shared/xai-relay/ticket.node.mjs';
import {
  relayAudio,
  relayEventSchema
} from '../../../shared/xai-relay/contract.mjs';

const secret = 'fictional-shared-signing-key-at-least-32-bytes';
const audience = 'wss://relay.example/stt';
const origin = 'https://doorknob.example';
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: unknown[] = [];
  closes = 0;
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closes++;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
  message(value: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(value)), false);
  }
}
function setup() {
  const client = new Socket(),
    upstream = new Socket();
  const calls: {
    url: string;
    options: { headers: { Authorization: string } };
  }[] = [];
  const close = bridge(client, {
    origin,
    audience,
    secret,
    key: 'fictional-xai-key',
    consume: createTicketConsumer(),
    dial: (url: string, options: { headers: { Authorization: string } }) => {
      calls.push({ url, options });
      return upstream;
    }
  });
  const authenticate = () =>
    client.message({
      type: 'authenticate',
      ticket: signRelayTicket(secret, audience, origin).value
    });
  return { client, upstream, calls, close, authenticate };
}

test('relay requires its own permanent key, signing key, fixed URL and allowed origins', () => {
  const env = {
    STT_XAI_API_KEY: 'fictional-key',
    STT_XAI_RELAY_SECRET: secret,
    STT_XAI_RELAY_URL: audience,
    STT_XAI_ALLOWED_ORIGINS: origin
  };
  assert.equal(relayConfiguration(env).key, 'fictional-key');
  for (const field of Object.keys(env))
    assert.throws(() => relayConfiguration({ ...env, [field]: '' }));
  assert.throws(() =>
    relayConfiguration({
      ...env,
      STT_XAI_RELAY_URL: 'ws://relay.example/stt',
      NODE_ENV: 'production'
    })
  );
});

test('tickets are single use and bound to the browser Origin and deployed relay', () => {
  const consume = createTicketConsumer();
  const ticket = signRelayTicket(secret, audience, origin).value;
  assert.throws(() =>
    consume(ticket, secret, audience, 'https://foreign.example')
  );
  consume(ticket, secret, audience, origin);
  assert.throws(() => consume(ticket, secret, audience, origin));
});

test('relay never dials unauthenticated clients and bounds startup work', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = setup();
  rejected.client.message({ type: 'authenticate', ticket: 'forged' });
  assert.equal(rejected.calls.length, 0);
  assert.equal(rejected.client.closes, 1);
  const idle = setup();
  t.mock.timers.tick(5_000);
  assert.equal(idle.client.closes, 1);
  const starting = setup();
  starting.authenticate();
  t.mock.timers.tick(20_000);
  assert.equal(starting.upstream.closes, 1);
});

test('relay fixes model/settings/authorization and forwards PCM and ordered finals without caching', () => {
  const s = setup();
  s.authenticate();
  const target = new URL(s.calls[0].url);
  assert.equal(target.origin, 'wss://api.x.ai');
  assert.equal(target.pathname, '/v1/stt');
  assert.equal(target.searchParams.get('model'), 'grok-voice-transcribe-2.0');
  assert.equal(target.searchParams.get('interim_results'), 'true');
  assert.equal(
    s.calls[0].options.headers.Authorization,
    'Bearer fictional-xai-key'
  );
  s.upstream.message({ type: 'transcript.created' });
  const pcm = Buffer.alloc(9600);
  s.client.emit('message', pcm, true);
  assert.equal(s.upstream.sent[0], pcm);
  s.client.message({ type: 'stop' });
  assert.equal(s.upstream.sent[1], '{"type":"audio.done"}');
  s.upstream.message({
    type: 'transcript.partial',
    text: 'Fictional.',
    start: 0,
    duration: 1,
    is_final: true,
    speech_final: true
  });
  s.upstream.message({
    type: 'transcript.done',
    text: 'Fictional.',
    duration: 1
  });
  assert.deepEqual(
    s.client.sent.map((frame) =>
      relayEventSchema.parse(JSON.parse(String(frame)))
    ),
    [
      { type: 'ready' },
      { type: 'final', text: 'Fictional.' },
      { type: 'interim', text: '' },
      { type: 'ended' }
    ]
  );
  assert.equal(s.client.closes, 1);
  assert.equal(s.upstream.closes, 1);
});

test('locked chunks reach the browser before errors and cumulative provider frames never leak through', () => {
  const s = setup();
  s.authenticate();
  s.upstream.message({
    type: 'transcript.created',
    private_metadata: 'never forwarded'
  });
  s.upstream.message({
    type: 'transcript.partial',
    text: 'Keep these words.',
    start: 0,
    duration: 1,
    is_final: true,
    speech_final: false
  });
  s.upstream.message({
    type: 'transcript.partial',
    text: 'Keep these words.',
    start: 0,
    duration: 1,
    is_final: true,
    speech_final: true
  });
  s.upstream.message({ type: 'error', message: 'private provider error' });
  assert.deepEqual(
    s.client.sent.map((frame) =>
      relayEventSchema.parse(JSON.parse(String(frame)))
    ),
    [
      { type: 'ready' },
      { type: 'final', text: 'Keep these words.' },
      { type: 'interim', text: '' },
      { type: 'error' }
    ]
  );
  assert.ok(!JSON.stringify(s.client.sent).includes('private'));
  assert.ok(!JSON.stringify(s.client.sent).includes('transcript.partial'));
  assert.equal(s.upstream.closes, 1);
});

test('audio before readiness, invalid messages, backpressure and provider errors close both sockets safely', () => {
  for (const failure of [
    'early',
    'control',
    'pressure',
    'provider',
    'disconnect'
  ]) {
    const s = setup();
    s.authenticate();
    if (failure !== 'early') s.upstream.message({ type: 'transcript.created' });
    if (failure === 'early') s.client.emit('message', Buffer.alloc(9600), true);
    if (failure === 'control')
      s.client.message({ type: 'change-model', model: 'other' });
    if (failure === 'pressure') {
      s.upstream.bufferedAmount = 192_001;
      s.client.emit('message', Buffer.alloc(9600), true);
    }
    if (failure === 'provider')
      s.upstream.message({
        type: 'error',
        message: 'private upstream details'
      });
    if (failure === 'disconnect') s.client.close();
    assert.equal(s.upstream.closes, 1);
    assert.equal(s.client.closes, 1);
    assert.ok(!JSON.stringify(s.client.sent).includes('private'));
  }
});

test('PCM worklet downmixes, clamps and writes little-endian frames; Stop flushes trailing samples exactly once', () => {
  let Processor!: new (options: {
    processorOptions: { samplesPerFrame: number };
  }) => {
    process(inputs: Float32Array[][]): boolean;
    port: { onmessage: (event: { data: string }) => void };
  };
  const frames: (ArrayBuffer | string)[] = [];
  class Base {
    port = {
      onmessage: () => {},
      postMessage: (frame: ArrayBuffer | string) => frames.push(frame)
    };
  }
  runInNewContext(
    readFileSync(
      new URL('../../../public/xai-pcm-worklet.js', import.meta.url),
      'utf8'
    ),
    {
      AudioWorkletProcessor: Base,
      sampleRate: 48_000,
      registerProcessor: (_name: string, ctor: typeof Processor) => {
        Processor = ctor;
      }
    }
  );
  const processor = new Processor({
    processorOptions: { samplesPerFrame: relayAudio.samplesPerFrame }
  });
  processor.process([
    [new Float32Array([1, -1, 2, 0]), new Float32Array([1, -1, 0, 0])]
  ]);
  assert.deepEqual(frames, []);
  processor.port.onmessage({ data: 'stop' });
  assert.equal(frames[1], 'stopped');
  const view = new DataView(frames[0] as ArrayBuffer);
  assert.deepEqual(
    [0, 2, 4, 6].map((offset) => view.getInt16(offset, true)),
    [32767, -32768, 32767, 0]
  );
  assert.equal(processor.process([[new Float32Array([1])]]), false);
});

for (const boundary of [
  'stop before ready',
  'duplicate ready',
  'audio after stop'
] as const) {
  test(`relay rejects ${boundary} and releases both sockets`, () => {
    const { client, upstream, authenticate, close } = setup();
    try {
      authenticate();
      if (boundary !== 'stop before ready')
        upstream.message({ type: 'transcript.created' });
      if (boundary === 'duplicate ready')
        upstream.message({ type: 'transcript.created' });
      else {
        client.message({ type: 'stop' });
        if (boundary === 'audio after stop')
          client.emit('message', Buffer.alloc(relayAudio.frameBytes), true);
      }
      assert.equal(client.readyState, 3);
      assert.equal(upstream.readyState, 3);
    } finally {
      close();
    }
  });
}
