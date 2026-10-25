import { speechDiagnostic } from './diagnostics';

/** App-authored configuration failure; never constructed from upstream response text. */
export class TranscriptionUnavailable extends Error {}

/** Fetch only a temporary credential, after an explicit recording tap. No audio is transmitted. */
export async function requestOpenAICredential(
  request: typeof fetch,
  signal: AbortSignal
): Promise<string> {
  const started = performance.now();
  const response = await request('/api/transcription/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal,
    cache: 'no-store'
  });
  signal.throwIfAborted();
  speechDiagnostic('credential-response', {
    status: response.status,
    elapsedMs: Math.round(performance.now() - started)
  });
  if (!response.ok) throw new TranscriptionUnavailable();
  const token: unknown = await response.json();
  signal.throwIfAborted();
  if (
    !token ||
    typeof token !== 'object' ||
    !('value' in token) ||
    typeof token.value !== 'string'
  )
    throw new Error('Invalid credential');
  return token.value;
}

async function prepareOffer(peer: RTCPeerConnection, signal: AbortSignal) {
  const started = performance.now();
  const offer = await peer.createOffer();
  signal.throwIfAborted();
  await peer.setLocalDescription(offer);
  signal.throwIfAborted();
  speechDiagnostic('webrtc-offer-created', {
    elapsedMs: Math.round(performance.now() - started)
  });
  return offer;
}

/** Prepare SDP/ICE while credentials load; only WebRTC carries subsequent microphone audio. */
export async function connectOpenAI(
  peer: RTCPeerConnection,
  request: typeof fetch,
  signal: AbortSignal,
  credential = requestOpenAICredential(request, signal)
) {
  const [offer, value] = await Promise.all([
    prepareOffer(peer, signal),
    credential
  ]);
  signal.throwIfAborted();
  const started = performance.now();
  const answer = await request('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    body: offer.sdp,
    headers: {
      authorization: `Bearer ${value}`,
      'content-type': 'application/sdp'
    },
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  });
  signal.throwIfAborted();
  speechDiagnostic('webrtc-answer-response', {
    status: answer.status,
    elapsedMs: Math.round(performance.now() - started)
  });
  if (!answer.ok) throw new Error('Connection failed');
  const sdp = await answer.text();
  signal.throwIfAborted();
  await peer.setRemoteDescription({ type: 'answer', sdp });
  speechDiagnostic('webrtc-answer-applied');
}
