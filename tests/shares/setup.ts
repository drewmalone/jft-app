// Explicit synthetic selection for server tests; keep OpenAI contract fixtures independent of the Soniox production default.
process.env.STT_PROVIDER = 'openai';

import { mock } from 'node:test';
import { readings } from '../../src/readings/server/configured-readings';
import { reflection } from '../fixtures/sample-reading';
// Existing share contracts use a stable synthetic reading. Catalog/source tests exercise actual YAML separately.
mock.method(readings, 'findByDate', async () => structuredClone(reflection));
mock.method(readings, 'today', async () => ({
  date: reflection.date,
  reading: structuredClone(reflection),
  sample: true
}));
