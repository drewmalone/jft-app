import { speechDiagnostic } from './diagnostics';

/** App-authored configuration failure; never constructed from upstream response text. */
export class TranscriptionUnavailable extends Error {}

/** Exchange one ephemeral credential and SDP answer; only WebRTC carries subsequent microphone audio. */
export async function connectOpenAI(
  peer: RTCPeerConnection,
  request: typeof fetch,
  signal: AbortSignal
) {
  const tokenResponse = await request('/api/transcription/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal,
    cache: 'no-store'
  });
  signal.throwIfAborted();
  speechDiagnostic('credential-response', { status: tokenResponse.status });
  if (!tokenResponse.ok) throw new TranscriptionUnavailable();
  const token: unknown = await tokenResponse.json();
  signal.throwIfAborted();
  if (
    !token ||
    typeof token !== 'object' ||
    !('value' in token) ||
    typeof token.value !== 'string'
  )
    throw new Error('Invalid credential');
  const offer = await peer.createOffer();
  speechDiagnostic('webrtc-offer-created');
  signal.throwIfAborted();
  await peer.setLocalDescription(offer);
  signal.throwIfAborted();
  const answer = await request('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    body: offer.sdp,
    headers: {
      authorization: `Bearer ${token.value}`,
      'content-type': 'application/sdp'
    },
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  });
  signal.throwIfAborted();
  speechDiagnostic('webrtc-answer-response', { status: answer.status });
  if (!answer.ok) throw new Error('Connection failed');
  const sdp = await answer.text();
  signal.throwIfAborted();
  await peer.setRemoteDescription({ type: 'answer', sdp });
  speechDiagnostic('webrtc-answer-applied');
}
