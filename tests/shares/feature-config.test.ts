import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeatureConfig } from '../../src/config/features';
import { parseQuotaPolicy } from '../../src/config/quotas';
import {
  validateRuntimeConfig,
  parseRuntimeConfig
} from '../../src/config/runtime';
import { createServerServices } from '../../src/server/services';

test('feature flags are independent, strict, and retain the legacy enable migration fallback', () => {
  const defaults = parseFeatureConfig({});
  assert.equal(defaults.transcription.enabled, false);
  assert.equal(defaults.cleanup.enabled, false);
  assert.equal(defaults.transcription.provider, 'soniox');
  const separate = parseFeatureConfig({
    STT_ENABLED: 'true',
    TRANSCRIPTION_ENABLED: 'false',
    CLEANUP_ENABLED: 'true'
  });
  assert.equal(separate.transcription.enabled, false);
  assert.equal(separate.cleanup.enabled, true);
  assert.equal(
    parseFeatureConfig({ STT_ENABLED: 'true' }).cleanup.enabled,
    true
  );
  for (const key of [
    'STT_ENABLED',
    'TRANSCRIPTION_ENABLED',
    'CLEANUP_ENABLED',
    'TRANSCRIPTION_DISABLED',
    'CLEANUP_DISABLED'
  ])
    assert.throws(() => validateRuntimeConfig({ [key]: 'typo' }));
});
test('known quota windows validate before deployment and ignore removed global settings', () => {
  for (const value of ['0', '-1', '', '1.2', 'NaN', '999999999999999999999'])
    assert.throws(() =>
      parseQuotaPolicy({ QUOTA_TRANSCRIPTION_OWNER_600: value })
    );
  const policy = parseQuotaPolicy({
    QUOTA_TRANSCRIPTION_OWNER_600: '2',
    QUOTA_TRANSCRIPTION_GLOBAL_86400: 'invalid'
  });
  assert.equal(policy.transcription[0].limit, 2);
  assert.equal(policy.cleanup[0].limit, 5);
  assert.equal(
    parseRuntimeConfig({ CLEANUP_ENABLED: 'true' }).CLEANUP_ENABLED,
    'true'
  );
});
test('service factories isolate state and leave unrelated dependencies lazy', () => {
  const a = createServerServices({
    SHARE_PERSISTENCE: 'memory',
    CLEANUP_ENABLED: 'true'
  });
  const b = createServerServices({ SHARE_PERSISTENCE: 'memory' });
  assert.equal(a.features.cleanup.enabled, true);
  assert.equal(a.shares, a.shares);
  assert.notEqual(a.shares, b.shares);
  assert.equal(a.readings, a.readings);
  assert.throws(() => createServerServices({ READINGS_SOURCE: 'invalid' }));
  assert.equal(a.quotas, a.quotas);
});
