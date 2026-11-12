import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { reflection } from '../../fixtures/sample-reading';

async function main() {
  // Real local-file loading with synthetic content, independent of the calendar date of the test run.
  const directory = await mkdtemp(join(tmpdir(), 'e2e-readings-'));
  const path = join(directory, 'readings.yaml');
  await writeFile(
    path,
    JSON.stringify({
      sample: true,
      readings: Array.from({ length: 9 }, (_, index) => ({
        ...reflection,
        date: new Date(Date.now() + (index - 4) * 86400_000)
          .toISOString()
          .slice(0, 10)
      }))
    })
  );
  const child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '0.0.0.0',
      '--port',
      '3101'
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        READINGS_SOURCE: 'local',
        READINGS_LOCAL_PATH: path
      }
    }
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => child.kill(signal));
  child.on('exit', async (code) => {
    await rm(directory, { recursive: true, force: true });
    process.exit(code ?? 0);
  });
}
void main();
