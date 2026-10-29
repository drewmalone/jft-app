import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueTranscriptionCredential } from '../../src/shares/server/transcription-provider';
import { cleanShareText } from '../../src/shares/server/cleanup-provider';
import { verifyRelayTicket } from '../../shared/xai-relay/ticket.node.mjs';

const origin = 'https://fictional.example';
const relay = 'wss://relay.example/stt';
const secret = 'fictional-relay-signing-secret-at-least-32-bytes';

test('xAI composition issues only relay authorization and rejects stale clients without contacting a provider', async (t) => {
  t.mock.property(process, 'env', {
    ...process.env,
    STT_XAI_RELAY_URL: relay,
    STT_XAI_RELAY_SECRET: secret
  });
  const requests = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected provider request');
  });
  const signal = new AbortController().signal;
  const token = await issueTranscriptionCredential(
    'xai',
    signal,
    origin,
    'xai'
  );
  assert.ok('provider' in token);
  assert.equal(token.provider, 'xai');
  assert.equal(token.relay_url, relay);
  assert.equal(
    verifyRelayTicket(token.value, secret, relay, origin).origin,
    origin
  );
  assert.ok(!JSON.stringify(token).includes(secret));
  for (const [provider, requested] of [
    ['xai', 'openai'],
    ['openai', 'xai']
  ] as const)
    await assert.rejects(
      issueTranscriptionCredential(provider, signal, origin, requested),
      /provider mismatch/
    );
  assert.equal(requests.mock.callCount(), 0);
});

for (const provider of ['openai', 'xai'] as const) {
  test(`OpenAI cleanup remains independent with STT_PROVIDER=${provider}`, async (t) => {
    t.mock.property(process, 'env', {
      ...process.env,
      STT_PROVIDER: provider,
      STT_OPENAI_API_KEY: 'fictional-openai-cleanup-key'
    });
    const requests: Request[] = [];
    t.mock.method(
      globalThis,
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return Response.json({
          id: 'resp_fiction',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              id: 'msg_fiction',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ text: 'Fictional cleaned text.' }),
                  annotations: []
                }
              ]
            }
          ]
        });
      }
    );
    assert.equal(
      await cleanShareText('Um fictional words.'),
      'Fictional cleaned text.'
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(
      requests[0].headers.get('authorization'),
      'Bearer fictional-openai-cleanup-key'
    );
  });
}
