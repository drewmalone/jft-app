import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('a fresh xAI server agrees with its bootstrap, rejects stale OpenAI clients, and retains OpenAI cleanup', () => {
  // A fresh process exercises immutable startup configuration without a test-only reset hook.
  const script = `
    import assert from 'node:assert/strict';
    import { dispatch } from './src/shares/server/app.ts';
    import { transcriptionProvider } from './src/shares/server/transcription-config.ts';
    console.warn = () => {};
    assert.equal(transcriptionProvider(), 'xai');
    process.env.STT_PROVIDER = 'openai';
    assert.equal(transcriptionProvider(), 'xai');
    const session = await dispatch(new Request('http://localhost/api/shares'));
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const headers = { origin: 'http://localhost', cookie, 'x-stt-provider': 'xai', 'content-type': 'application/json' };
    const token = await dispatch(new Request('http://localhost/api/transcription/session', { method: 'POST', headers }));
    assert.equal(token.status, 200);
    const body = await token.json();
    assert.equal(body.provider, 'xai');
    assert.equal(body.relay_url, 'wss://relay.example/stt');
    assert.ok(!JSON.stringify(body).includes(process.env.STT_XAI_RELAY_SECRET));
    const stale = await dispatch(new Request('http://localhost/api/transcription/session', { method: 'POST', headers: { ...headers, 'x-stt-provider': 'openai' } }));
    assert.equal(stale.status, 503);
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      assert.equal(request.url, 'https://api.openai.com/v1/responses');
      assert.equal(request.headers.get('authorization'), 'Bearer fictional-openai-cleanup-key');
      return Response.json({ id:'resp_fiction', object:'response', status:'completed', output:[{
        type:'message', id:'msg_fiction', role:'assistant', status:'completed',
        content:[{ type:'output_text', text:JSON.stringify({text:'Fictional cleaned text.'}), annotations:[] }]
      }] });
    };
    const cleaned = await dispatch(new Request('http://localhost/api/shares/cleanup', { method: 'POST', headers, body: JSON.stringify({ text:'Um fictional words.' }) }));
    assert.equal(cleaned.status, 200);
    assert.deepEqual(await cleaned.json(), { text:'Fictional cleaned text.' });
  `;
  execFileSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      script
    ],
    {
      cwd: process.cwd(),
      timeout: 15_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        SESSION_SECRET: 'fictional-session-secret-at-least-32-bytes',
        STT_PROVIDER: 'xai',
        STT_ENABLED: 'true',
        STT_XAI_RELAY_URL: 'wss://relay.example/stt',
        STT_XAI_RELAY_SECRET: 'fictional-shared-relay-secret-at-least-32-bytes',
        STT_OPENAI_API_KEY: 'fictional-openai-cleanup-key'
      }
    }
  );
});

test('invalid startup selection fails with an authored message and no environment value', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          '--conditions=react-server',
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
    import { transcriptionProvider } from './src/shares/server/transcription-config.ts';
    transcriptionProvider();
  `
        ],
        {
          cwd: process.cwd(),
          timeout: 10_000,
          stdio: 'pipe',
          env: { ...process.env, STT_PROVIDER: 'unsupported-private-value' }
        }
      ),
    (error: unknown) => {
      const stderr = (error as { stderr: Buffer }).stderr.toString();
      assert.match(stderr, /STT_PROVIDER must be openai or xai/);
      assert.ok(!stderr.includes('unsupported-private-value'));
      return true;
    }
  );
});
