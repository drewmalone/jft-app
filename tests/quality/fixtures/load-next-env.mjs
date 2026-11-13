// Isolated process: Next caches its initial environment. Emit only fictional fixture settings.
import { pathToFileURL } from 'node:url';
const { default: environment } = await import(
  pathToFileURL(process.argv[2]).href
);
const { loadEnvConfig } = environment;
const keys = [
  'SHARE_PERSISTENCE',
  'DYNAMODB_TABLE_NAME',
  'DYNAMODB_REGION',
  'READINGS_SOURCE',
  'READINGS_SAMPLE',
  'READINGS_TABLE_NAME',
  'READINGS_LOCAL_PATH',
  'READINGS_S3_BUCKET',
  'READINGS_S3_KEY',
  'READINGS_REGION',
  'STT_PROVIDER',
  'STT_ENABLED',
  'TRANSCRIPTION_ENABLED',
  'CLEANUP_ENABLED',
  'TRANSCRIPTION_DISABLED',
  'CLEANUP_DISABLED',
  'QUOTA_TABLE_NAME',
  'SESSION_SECRET',
  'QUOTED',
  'MULTILINE'
];
for (const key of keys) delete process.env[key];
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
process.stdout.write(
  JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key]])))
);
