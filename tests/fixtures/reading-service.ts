import type { TestContext } from 'node:test';
import { readings } from '../../src/readings/server/configured-readings';
import { reflection } from './sample-reading';

/** Opt a single HTTP test into stable synthetic content; TestContext restores both methods afterward. */
export function useReadingFixture(t: TestContext) {
  t.mock.method(readings, 'findByDate', async () =>
    structuredClone(reflection)
  );
  t.mock.method(readings, 'today', async () => ({
    date: reflection.date,
    reading: structuredClone(reflection),
    sample: true
  }));
}
