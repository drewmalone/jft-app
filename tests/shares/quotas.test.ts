import { useReadingFixture } from '../fixtures/reading-service';
import { reflection } from '../fixtures/sample-reading';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  QuotaService,
  QuotaExceeded,
  type Counter
} from '../../src/server/abuse/quotas';
import { DynamoQuotaBackend } from '../../src/server/abuse/dynamodb-quotas';
import { MemoryQuotaBackend } from '../../src/server/abuse/memory-quotas';
import { parseQuotaPolicy } from '../../src/config/quotas';

test('shared backend serializes the final allowance across independent services without limiting other owners', async () => {
  const backend = new MemoryQuotaBackend();
  const env = {
    QUOTA_TRANSCRIPTION_OWNER_600: '1',
    QUOTA_TRANSCRIPTION_GLOBAL_86400: '1'
  };
  const a = new QuotaService(backend, () => 1000000, parseQuotaPolicy(env));
  const b = new QuotaService(backend, () => 1000000, parseQuotaPolicy(env));
  const results = await Promise.allSettled([
    a.check('transcription', 'owner-a'),
    b.check('transcription', 'owner-a')
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.doesNotReject(b.check('transcription', 'new-owner'));
  await assert.doesNotReject(b.check('cleanup', 'owner-a'));
});

test('owner quota, atomic rejection, and fixed-window expiry use a controlled clock', async () => {
  let now = 0;
  const backend = new MemoryQuotaBackend();
  const service = new QuotaService(backend, () => now);
  for (let i = 0; i < 3; i++)
    await assert.doesNotReject(service.check('transcription', 'a'));
  await assert.rejects(service.check('transcription', 'a'), {
    retryAfter: 600
  });
  await assert.doesNotReject(service.check('transcription', 'b'));
  now = 600000;
  await assert.doesNotReject(service.check('transcription', 'a'));
});

test('backend failure and independent dynamic kill switches reject paid usage', async () => {
  const broken = new QuotaService({
    consume: async () => {
      throw new Error('offline');
    },
    disabled: async () => false
  });
  await assert.rejects(broken.check('transcription', 'a'));
  const backend = new MemoryQuotaBackend();
  backend.disabled = async (op?: string) => op === 'cleanup';
  const service = new QuotaService(backend, () => 0);
  await assert.rejects(service.check('cleanup', 'a'));
  await assert.doesNotReject(service.check('transcription', 'a'));
});

test('DynamoDB adapter writes all counters in one conditional transaction and distinguishes outages', async () => {
  const counters: Counter[] = [
    { id: 'test:owner', limit: 1, expiresAt: 100 },
    { id: 'test:daily', limit: 2, expiresAt: 100 }
  ];
  let input: unknown;
  const client = {
    send: async (command: { input: unknown }) => {
      input = command.input;
      return {};
    }
  };
  const backend = new DynamoQuotaBackend('quotas', client as never);
  await backend.consume(counters);
  const items = (
    input as { TransactItems: { Update: Record<string, unknown> }[] }
  ).TransactItems;
  assert.equal(items.length, 2);
  for (const item of items)
    assert.equal(
      item.Update.ConditionExpression,
      'attribute_not_exists(#count) OR #count < :limit'
    );
  client.send = async () => {
    throw Object.assign(new Error('quota'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }]
    });
  };
  await assert.rejects(backend.consume(counters), {
    message: 'quota exceeded'
  });
  client.send = async () => {
    throw new Error('offline');
  };
  await assert.rejects(backend.consume(counters));
});

test('HTTP quota rejection and backend outage never invoke a provider; private reads fail open', async (t) => {
  const { dispatch } = await import('../fixtures/application');
  const session = await dispatch(new Request('http://localhost/api/shares'));
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  const provider = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('must not call provider');
  });
  let offline = false;
  t.mock.method(QuotaService.prototype, 'check', async () => {
    if (offline) throw new Error('unavailable');
    throw new QuotaExceeded(123);
  });
  const post = () =>
    dispatch(
      new Request('http://localhost/api/transcription/session', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost' }
      })
    );
  let response = await post();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '123');
  assert.equal((await response.json()).error.code, 'RATE_LIMITED');
  offline = true;
  response = await post();
  assert.equal(response.status, 503);
  assert.equal(provider.mock.callCount(), 0);
  assert.equal(
    (
      await dispatch(
        new Request('http://localhost/api/shares', { headers: { cookie } })
      )
    ).status,
    200
  );
});

test('share creation rejects malformed drafts before quota use and stops writes at owner allowance', async (t) => {
  useReadingFixture(t);
  const { dispatch } = await import('../fixtures/application');
  const session = await dispatch(new Request('http://localhost/api/shares'));
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  const save = (body: unknown) =>
    dispatch(
      new Request('http://localhost/api/shares', {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
          origin: 'http://localhost'
        },
        body: JSON.stringify(body)
      })
    );
  for (let i = 0; i < 12; i++)
    assert.equal((await save({ text: '', ownerId: 'untrusted' })).status, 400);
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await save({ text: 'Fictional quota fixture.' })).status,
      201
    );
  const denied = await save({ text: 'Fictional over-limit fixture.' });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) > 0);
  const history = await dispatch(
    new Request('http://localhost/api/shares', { headers: { cookie } })
  );
  assert.equal((await history.json()).length, 10);
});

test('untrusted forwarding and owner headers do not change verified quota ownership', async (t) => {
  const { dispatch } = await import('../fixtures/application');
  const session = await dispatch(new Request('http://localhost/api/shares'));
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  const owners: (string | undefined)[] = [];
  t.mock.method(
    QuotaService.prototype,
    'check',
    async (_op: string, owner?: string) => {
      owners.push(owner);
      return;
    }
  );
  for (const spoof of ['one', 'two']) {
    const response = await dispatch(
      new Request('http://localhost/api/shares', {
        headers: {
          cookie,
          'x-owner-id': spoof,
          'x-forwarded-for': `192.0.2.${spoof === 'one' ? 1 : 2}`,
          'x-forwarded-host': 'untrusted.example'
        }
      })
    );
    assert.equal(response.status, 200);
  }
  assert.equal(owners.length, 2);
  assert.ok(owners[0]);
  assert.equal(owners[0], owners[1]);
  assert.ok(!owners.includes('one') && !owners.includes('two'));
});

test('daily owner allowances survive short-window resets and expire independently of TTL cleanup', async () => {
  for (const [operation, perWindow, daily] of [
    ['transcription', 3, 15],
    ['cleanup', 5, 30]
  ] as const) {
    let now = 0;
    const service = new QuotaService(new MemoryQuotaBackend(), () => now);
    for (let i = 0; i < daily; i++) {
      now = Math.floor(i / perWindow) * 600000;
      await assert.doesNotReject(service.check(operation, 'owner'));
    }
    now += 600000;
    await assert.rejects(service.check(operation, 'owner'), {
      retryAfter: 86400 - now / 1000
    });
    await assert.doesNotReject(service.check(operation, 'different-owner'));
    now = 86400000;
    await assert.doesNotReject(service.check(operation, 'owner'));
  }
});

test('public reads do not consult the quota backend', async (t) => {
  const { readPublicShare } =
    await import('../../src/shares/server/application/read-public-share');
  const { InMemoryShareRepository } =
    await import('../../src/shares/server/storage/memory-repository');
  const { randomUUID } = await import('node:crypto');
  const repository = new InMemoryShareRepository();
  const share = await repository.create(
    randomUUID(),
    'Fictional public reflection.',
    reflection
  );
  const check = t.mock.method(QuotaService.prototype, 'check', async () => {
    throw new Error('quota backend unavailable');
  });
  assert.equal((await readPublicShare(share.id, repository))?.text, share.text);
  assert.equal(check.mock.callCount(), 0);
});

test('paid quota checks share one overall deadline across the control read and transaction', async (t) => {
  const controller = new AbortController();
  const timeout = t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 8000);
    return controller.signal;
  });
  const signals: AbortSignal[] = [];
  const backend = new DynamoQuotaBackend('fictional-quotas', {
    send: async (_command: unknown, options: { abortSignal: AbortSignal }) => {
      signals.push(options.abortSignal);
      if (signals.length === 1) return {};
      return new Promise((_resolve, reject) =>
        options.abortSignal.addEventListener(
          'abort',
          () => reject(options.abortSignal.reason),
          { once: true }
        )
      );
    }
  } as never);
  const pending = new QuotaService(backend).check('cleanup', 'fictional-owner');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  assert.equal(timeout.mock.callCount(), 1);
  controller.abort(new DOMException('Fictional timeout', 'TimeoutError'));
  await assert.rejects(pending, { name: 'TimeoutError' });
});

test('an expired control read never starts a quota transaction', async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  let calls = 0;
  const backend = new DynamoQuotaBackend('fictional-quotas', {
    send: async () => {
      calls++;
      controller.abort(new DOMException('Fictional timeout', 'TimeoutError'));
      return {};
    }
  } as never);
  await assert.rejects(
    new QuotaService(backend).check('transcription', 'fictional-owner'),
    { name: 'TimeoutError' }
  );
  assert.equal(calls, 1);
});
