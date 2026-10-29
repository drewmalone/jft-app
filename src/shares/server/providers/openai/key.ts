import 'server-only';
import { createSecretReader } from '../../secrets-manager';

/** Safe configuration categories for diagnostics; never includes secret values or AWS error text. */
export class OpenAIKeyError extends Error {
  constructor(
    readonly reason:
      'missing_key' | 'invalid_secret_arn' | 'secret_unavailable',
    message: string
  ) {
    super(message);
  }
}

const readSecret = createSecretReader((value) => value);

/** Local server binding or Amplify compute-role access to a plain-string Secrets Manager secret. Never client bundled. */
export async function openAIKey(): Promise<string> {
  if (process.env.STT_OPENAI_API_KEY) return process.env.STT_OPENAI_API_KEY;
  const arn = process.env.STT_OPENAI_SECRET_ARN;
  if (!arn)
    throw new OpenAIKeyError('missing_key', 'Transcription is not configured');
  const region = arn.split(':')[3];
  if (!region || !arn.startsWith('arn:aws:secretsmanager:'))
    throw new OpenAIKeyError('invalid_secret_arn', 'Invalid secret ARN');
  try {
    return await readSecret({ arn, region });
  } catch {
    throw new OpenAIKeyError('secret_unavailable', 'Secret unavailable');
  }
}
