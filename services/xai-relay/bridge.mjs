import { verifyRelayTicket } from './ticket.mjs';

/** One replica owns ticket replay protection. Expired ticket IDs contain no audio or text. */
export function createTicketConsumer() {
  const used = new Map();
  return (ticket, secret, audience, origin) => {
    const now = Math.floor(Date.now() / 1000);
    for (const [nonce, expiry] of used) if (expiry <= now) used.delete(nonce);
    const claims = verifyRelayTicket(ticket, secret, audience, origin);
    if (used.has(claims.nonce) || used.size >= 10_000)
      throw new Error('Ticket already used or relay busy');
    used.set(claims.nonce, claims.exp);
  };
}

/**
 * Authenticate before dialing a fixed upstream. Both sockets are ws-compatible event emitters.
 * Payloads are forwarded in wire order, never logged, persisted or exposed in close reasons.
 */
export function bridge(
  client,
  { origin, audience, secret, key, consume, dial }
) {
  let upstream;
  let ready = false;
  let authenticated = false;
  let endedAudio = false;
  let closed = false;
  let bytes = 0;
  let started = 0;
  const timers = new Set();
  const later = (callback, ms) => {
    const timer = setTimeout(callback, ms);
    timers.add(timer);
    return timer;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    timers.forEach(clearTimeout);
    // Terminate the upstream immediately to release billable work, including a pending handshake.
    upstream?.terminate();
    client.close(1000);
  };
  const fail = () => {
    if (closed) return;
    if (client.readyState === 1) client.send(JSON.stringify({ type: 'error' }));
    close();
  };
  const authDeadline = later(fail, 5_000);
  client.on('error', close);
  client.on('close', close);
  client.on('message', (data, binary) => {
    if (closed) return;
    try {
      if (!authenticated) {
        if (binary || data.length > 4096)
          throw new Error('Invalid authentication');
        const auth = JSON.parse(data.toString());
        if (auth.type !== 'authenticate')
          throw new Error('Authentication required');
        consume(auth.ticket, secret, audience, origin);
        authenticated = true;
        clearTimeout(authDeadline);
        const url = new URL('wss://api.x.ai/v1/stt');
        url.search = new URLSearchParams({
          model: 'grok-voice-transcribe-2.0',
          encoding: 'pcm',
          sample_rate: '48000',
          interim_results: 'true',
          language: 'en',
          format: 'true'
        }).toString();
        upstream = dial(url.href, {
          headers: { Authorization: `Bearer ${key}` },
          maxPayload: 65_536,
          perMessageDeflate: false,
          handshakeTimeout: 15_000
        });
        const startDeadline = later(fail, 20_000);
        later(fail, 20_000 + 10 * 60_000 + 5_000);
        upstream.on('error', fail);
        upstream.on('close', () => {
          if (!closed) fail();
        });
        upstream.on('message', (frame, isBinary) => {
          if (closed) return;
          try {
            if (
              isBinary ||
              frame.length > 65_536 ||
              client.bufferedAmount > 192_000
            )
              throw new Error('Invalid upstream frame');
            const event = JSON.parse(frame.toString());
            if (event.type === 'transcript.created') {
              if (ready) throw new Error('Duplicate readiness');
              ready = true;
              started = Date.now();
              clearTimeout(startDeadline);
            } else if (
              !ready ||
              !['transcript.partial', 'transcript.done', 'error'].includes(
                event.type
              )
            )
              throw new Error('Invalid event');
            if (event.type === 'error') {
              fail();
              return;
            }
            if (event.type === 'transcript.done' && !endedAudio)
              throw new Error('Unexpected completion');
            client.send(frame.toString());
            if (event.type === 'transcript.done') close();
          } catch {
            fail();
          }
        });
        return;
      }
      if (
        !ready ||
        endedAudio ||
        upstream.readyState !== 1 ||
        upstream.bufferedAmount > 192_000
      )
        throw new Error('Relay unavailable');
      if (binary) {
        bytes += data.length;
        // PCM16 48 kHz mono, allowing two seconds of network scheduling jitter.
        if (
          !data.length ||
          data.length > 9600 ||
          data.length % 2 ||
          bytes > 96_000 * (2 + (Date.now() - started) / 1000)
        )
          throw new Error('Audio limit');
        upstream.send(data, { binary: true });
      } else {
        if (
          data.length > 128 ||
          JSON.parse(data.toString()).type !== 'audio.done'
        )
          throw new Error('Invalid control');
        endedAudio = true;
        upstream.send(JSON.stringify({ type: 'audio.done' }));
        later(fail, 5_000);
      }
    } catch {
      fail();
    }
  });
  return close;
}
