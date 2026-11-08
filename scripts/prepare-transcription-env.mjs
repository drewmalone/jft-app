import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Build-time configuration contains ARNs/flags only, never provider keys.
const file = '.env.production';
const keys = [
  'STT_ENABLED',
  'STT_PROVIDER',
  'STT_SONIOX_SECRET_ARN',
  'STT_OPENAI_SECRET_ARN'
];
const entries = [];
for (const key of keys) {
  const value = process.env[key];
  if (value === undefined) continue;
  if (!/^[a-zA-Z0-9_:/+=@.-]+$/.test(value)) throw new Error(`Invalid ${key}`);
  entries.push(`${key}=${value}`);
}
const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
const retained = existing
  .replaceAll('\r\n', '\n')
  .split('\n')
  .filter((line) => {
    const equals = line.indexOf('=');
    if (equals === -1) return true;
    const key = line
      .slice(0, equals)
      .trim()
      .replace(/^export\s+/, '');
    return !keys.includes(key);
  });
const content = [retained.join('\n').trimEnd(), ...entries]
  .filter(Boolean)
  .join('\n');
writeFileSync(file, `${content}\n`, { mode: 0o600 });
console.log('Prepared non-secret SSR transcription settings.');
