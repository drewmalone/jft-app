/**
 * Amplify exposes build variables separately from the Next.js SSR runtime.
 * Run `node scripts/prepare-transcription-env.mjs` from the repository root,
 * immediately before `npm run build` in the trusted branch's build commands.
 * This updates only non-secret speech settings in .env.production; existing
 * assignments are parsed/serialized with dotenv libraries. Provider API keys
 * must stay in Secrets Manager and are never copied from the build environment.
 * Local development uses .env.local and does not need this script.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseEnv } from 'dotenv';
import stringify from 'dotenv-stringify';
import { parse as parseArn } from '@aws-sdk/util-arn-parser';

const file = '.env.production';
const settings = existsSync(file) ? parseEnv(readFileSync(file)) : {};
const choices = {
  STT_ENABLED: ['true', 'false'],
  STT_PROVIDER: ['soniox', 'openai']
};
const keys = [
  ...Object.keys(choices),
  'STT_SONIOX_SECRET_ARN',
  'STT_OPENAI_SECRET_ARN'
];

for (const key of keys) {
  delete settings[key];
  const value = process.env[key];
  if (value === undefined) continue;
  try {
    if (choices[key]) {
      if (!choices[key].includes(value)) throw new Error('Invalid option');
    } else {
      const arn = parseArn(value);
      if (
        arn.service !== 'secretsmanager' ||
        !arn.resource.startsWith('secret:') ||
        !arn.region
      ) {
        throw new Error('Not a regional Secrets Manager secret');
      }
    }
  } catch {
    throw new Error(`Invalid ${key}`);
  }
  settings[key] = value;
}

writeFileSync(file, stringify(settings), { mode: 0o600 });
console.log('Prepared non-secret SSR transcription settings.');
