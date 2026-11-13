/** Validate deployment settings and fix provider selection at startup, without loading credentials. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getServerServices } = await import('./server/services');
    try {
      const config = getServerServices().config;
      if (config.deployment !== 'local') {
        const { validateSigningSecret } = await import('./config/deployment');
        validateSigningSecret(process.env);
      }
    } catch {
      throw new Error(
        'Invalid runtime configuration. Check deployment settings.'
      );
    }
  }
}
