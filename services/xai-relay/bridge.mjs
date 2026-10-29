import { verifyRelayTicket } from '../../shared/xai-relay/ticket.node.mjs';
import {
  relayAudio,
  relayCommandSchema,
  relayLimits
} from '../../shared/xai-relay/contract.mjs';
import { createXaiTranscript } from './transcript.mjs';

/** @typedef {{readyState: number, bufferedAmount: number, on: import('node:events').EventEmitter['on'], send: {(data: string | Uint8Array): void; (data: string | Uint8Array, options: {binary: boolean}): void}, close(code?: number): void, terminate(): void}} RelaySocket */
/** @typedef {{headers: {Authorization: string}, maxPayload: number, perMessageDeflate: boolean, handshakeTimeout: number}} UpstreamOptions */

/** One replica owns ticket replay protection. Expired IDs contain no audio or text. */
export function createTicketConsumer() {
  /** @type {Map<string, number>} */
  const used = new Map();
  /** @param {string} ticket @param {string} secret @param {string} audience @param {string} origin */
  return (ticket, secret, audience, origin) => {
    const now = Math.floor(Date.now() / 1000);
    for (const [nonce, expiry] of used) if (expiry <= now) used.delete(nonce);
    const claims = verifyRelayTicket(ticket, secret, audience, origin);
    if (used.has(claims.nonce) || used.size >= 10_000)
      throw new Error('Ticket already used or relay busy');
    used.set(claims.nonce, claims.exp);
  };
}

/** Normalize ws's supported data representations at the transport boundary. @param {unknown} data */
function frameBytes(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data) && data.every(Buffer.isBuffer))
    return Buffer.concat(data);
  throw new Error('Invalid WebSocket frame');
}

/**
 * One relay connection owns authentication, streaming and finalization. Provider parsing
 * stays in transcript.mjs; only application events leave this module.
 * @param {RelaySocket} client
 * @param {{origin: string, audience: string, secret: string, key: string, consume: ReturnType<typeof createTicketConsumer>, dial(url: string, options: UpstreamOptions): RelaySocket}} options
 */
export function bridge(
  client,
  { origin, audience, secret, key, consume, dial }
) {
  /** @type {'authenticating' | 'connecting' | 'streaming' | 'finalizing' | 'closed'} */
  let phase = 'authenticating';
  /** @type {RelaySocket | undefined} */
  let upstream;
  let bytes = 0,
    started = 0;
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  /** @param {import('../../shared/xai-relay/contract.mjs').RelayEvent} event */
  function send(event) {
    if (phase === 'closed') return;
    if (
      client.readyState !== 1 ||
      client.bufferedAmount > relayAudio.maxBufferedBytes
    )
      throw new Error('Client unavailable');
    client.send(JSON.stringify(event));
  }
  const transcript = createXaiTranscript({
    interim: (text) => send({ type: 'interim', text }),
    final: (text) => send({ type: 'final', text })
  });
  /** @param {() => void} callback @param {number} ms */
  function later(callback, ms) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, ms);
    timers.add(timer);
    return timer;
  }
  function close() {
    if (phase === 'closed') return;
    phase = 'closed';
    timers.forEach(clearTimeout);
    timers.clear();
    // Also cancels a pending provider handshake and its billable work.
    upstream?.terminate();
    client.close(1000);
  }
  function fail() {
    if (phase === 'closed') return;
    try {
      send({ type: 'error' });
    } catch {
      /* A failed transport cannot receive a notice. */
    } finally {
      close();
    }
  }
  const authDeadline = later(fail, relayLimits.authTimeoutMs);
  let startDeadline = authDeadline;

  /** @param {Buffer} data */
  function authenticate(data) {
    if (data.length > relayLimits.maxAuthBytes)
      throw new Error('Invalid authentication');
    const auth = relayCommandSchema.parse(JSON.parse(data.toString()));
    if (auth.type !== 'authenticate')
      throw new Error('Authentication required');
    consume(auth.ticket, secret, audience, origin);
    phase = 'connecting';
    clearTimeout(authDeadline);
    const url = new URL('wss://api.x.ai/v1/stt');
    url.search = new URLSearchParams({
      model: 'grok-voice-transcribe-2.0',
      encoding: 'pcm',
      sample_rate: String(relayAudio.sampleRate),
      interim_results: 'true',
      language: 'en',
      format: 'true'
    }).toString();
    upstream = dial(url.href, {
      headers: { Authorization: `Bearer ${key}` },
      maxPayload: relayLimits.maxEventBytes,
      perMessageDeflate: false,
      handshakeTimeout: 15_000
    });
    startDeadline = later(fail, relayLimits.startTimeoutMs);
    later(
      fail,
      relayLimits.startTimeoutMs +
        relayLimits.maxSessionMs +
        relayLimits.finalTimeoutMs
    );
    upstream.on('error', fail);
    upstream.on('close', fail);
    upstream.on('message', onProviderMessage);
  }
  /** @param {unknown} data @param {boolean} binary */
  function onProviderMessage(data, binary) {
    if (phase === 'closed') return;
    try {
      const frame = frameBytes(data);
      if (binary || frame.length > relayLimits.maxEventBytes)
        throw new Error('Invalid upstream frame');
      /** @type {unknown} */
      const event = JSON.parse(frame.toString());
      if (!event || typeof event !== 'object' || !('type' in event))
        throw new Error('Invalid event');
      if (event.type === 'transcript.created') {
        if (phase !== 'connecting') throw new Error('Duplicate readiness');
        phase = 'streaming';
        started = Date.now();
        clearTimeout(startDeadline);
        send({ type: 'ready' });
        return;
      }
      if (phase !== 'streaming' && phase !== 'finalizing')
        throw new Error('Transcript before readiness');
      if (event.type === 'transcript.done' && phase !== 'finalizing')
        throw new Error('Unexpected completion');
      if (transcript.accept(event)) {
        send({ type: 'ended' });
        close();
      }
    } catch {
      fail();
    }
  }
  /** @param {Buffer} data */
  function forwardAudio(data) {
    bytes += data.length;
    if (
      !data.length ||
      data.length > relayAudio.frameBytes ||
      data.length % relayAudio.bytesPerSample ||
      bytes >
        relayAudio.bytesPerSecond *
          (relayAudio.jitterSeconds + (Date.now() - started) / 1000)
    )
      throw new Error('Audio limit');
    upstream?.send(data, { binary: true });
  }
  /** @param {Buffer} data */
  function finishAudio(data) {
    if (
      data.length > relayLimits.maxControlBytes ||
      relayCommandSchema.parse(JSON.parse(data.toString())).type !== 'stop'
    )
      throw new Error('Invalid control');
    phase = 'finalizing';
    later(fail, relayLimits.finalTimeoutMs);
    upstream?.send(JSON.stringify({ type: 'audio.done' }));
  }
  /** @param {unknown} data @param {boolean} binary */
  function onClientMessage(data, binary) {
    if (phase === 'closed') return;
    try {
      const frame = frameBytes(data);
      if (phase === 'authenticating') {
        if (binary) throw new Error('Authentication required');
        authenticate(frame);
        return;
      }
      if (
        phase !== 'streaming' ||
        upstream?.readyState !== 1 ||
        upstream.bufferedAmount > relayAudio.maxBufferedBytes
      )
        throw new Error('Relay unavailable');
      if (binary) forwardAudio(frame);
      else finishAudio(frame);
    } catch {
      fail();
    }
  }
  client.on('error', close);
  client.on('close', close);
  client.on('message', onClientMessage);
  return close;
}
