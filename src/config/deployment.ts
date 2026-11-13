import { z } from 'zod';

type Environment = Readonly<Record<string, string | undefined>>;
/** NODE_ENV also describes local production builds; deployment intent is explicit. */
export function deploymentEnvironment(env: Environment) {
  if (
    env.DEPLOYMENT_ENV === undefined &&
    (env.AWS_APP_ID || env.AWS_BRANCH || env.AWS_LAMBDA_FUNCTION_NAME)
  )
    throw new Error('Hosted deployments require an explicit DEPLOYMENT_ENV');
  return z.enum(['local', 'dev', 'prod']).parse(env.DEPLOYMENT_ENV ?? 'local');
}
export function validateSigningSecret(env: Environment) {
  if (!env.SESSION_SECRET || Buffer.byteLength(env.SESSION_SECRET) < 32)
    throw new Error(
      'Hosted runtime requires a stable SESSION_SECRET of at least 32 bytes'
    );
}
