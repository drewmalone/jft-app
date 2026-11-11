import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import dotenvSource from '@dotenvx/primitives';
import { parseRuntimeConfig } from '../src/config/runtime';

/** Update the single Amplify runtime file, preserving unrelated assignments and secret delivery. */
function main() {
  // Validate before reading/writing the artifact. Do not print input values on failure.
  let config;
  try {
    config = parseRuntimeConfig(process.env);
  } catch {
    throw new Error(
      'Invalid runtime configuration. Check storage, readings and speech settings.'
    );
  }
  const file = '.env.production';
  let content = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const settings = {
    DYNAMODB_TABLE_NAME: '',
    DYNAMODB_REGION: '',
    READINGS_TABLE_NAME: '',
    ...config
  };
  for (const [key, value] of Object.entries(settings))
    content = dotenvSource.upsert(content, key, value);
  writeFileSync(file, content, { mode: 0o600 });
  console.log('Prepared non-secret SSR runtime settings.');
}
main();
