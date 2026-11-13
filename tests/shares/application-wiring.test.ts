import '@hono/zod-openapi';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpApplication } from '../../src/server/app';
import { createServerServices } from '../../src/server/services';
import { reflection } from '../fixtures/sample-reading';

test('application instances bind immutable configuration and isolate repositories without global mocks', async () => {
  const environment = { CLEANUP_ENABLED: 'false', STT_PROVIDER: 'soniox' };
  const source = (title: string) => ({
    findByDate: async () => ({ ...reflection, title }),
    today: async () => ({
      date: reflection.date,
      reading: { ...reflection, title },
      sample: true
    })
  });
  const a = createServerServices(environment, {
    readings: source('Fictional A')
  });
  const b = createServerServices(
    { CLEANUP_ENABLED: 'true', STT_PROVIDER: 'openai' },
    { readings: source('Fictional B') }
  );
  environment.CLEANUP_ENABLED = 'true';
  environment.STT_PROVIDER = 'openai';
  assert.equal(a.features.cleanup.enabled, false);
  assert.equal(a.features.transcription.provider, 'soniox');
  assert.equal(b.features.cleanup.enabled, true);
  assert.ok(Object.isFrozen(a.config));
  assert.ok(Object.isFrozen(a.config.features.cleanup));
  assert.ok(Object.isFrozen(a.config.quotas.policy.create));
  assert.equal(Reflect.set(a.features.cleanup, 'enabled', true), false);
  const appA = createHttpApplication(a),
    appB = createHttpApplication(b);
  const session = await appA.dispatch(
    new Request('http://localhost/api/session', {
      method: 'POST',
      headers: { origin: 'http://localhost' }
    })
  );
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  const saved = await appA.dispatch(
    new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Fictional isolated share.' })
    })
  );
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).reflection.title, 'Fictional A');
  const [own, foreign] = await Promise.all(
    [appA, appB].map((app) =>
      app.dispatch(
        new Request('http://localhost/api/shares', { headers: { cookie } })
      )
    )
  );
  assert.equal((await own.json()).length, 1);
  assert.deepEqual(await foreign.json(), []);
  const missing = await appA.dispatch(
    new Request('http://localhost/api/unknown-resource')
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('set-cookie'), null);
  assert.equal(missing.headers.get('cache-control'), 'private, no-store');
});
