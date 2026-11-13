import { localCatalog } from '../src/readings/server/sources';
import { parseCatalog } from '../src/readings/server/catalog';
import { readingFailureMessage } from '../src/readings/server/diagnostics';

/** Validate the configured local file or an explicit shell path, without starting Next or contacting AWS. */
async function main() {
  const args = process.argv.slice(2);
  const requireComplete = args.includes('--production');
  const path =
    args.find((arg) => arg !== '--production') ??
    process.env.READINGS_LOCAL_PATH ??
    'infra/terraform/readings.example.yaml';
  try {
    const loaded = await localCatalog(path)();
    if (!('content' in loaded)) throw new Error('No catalog content.');
    const catalog = parseCatalog(loaded.content, { requireComplete });
    console.log(`Validated ${catalog.byDay.size} annual readings.`);
  } catch (cause) {
    console.error(`[readings] ${readingFailureMessage(cause)}`);
    process.exitCode = 1;
  }
}
void main();
