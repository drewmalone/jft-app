/** Validate deployment settings and fix provider selection at startup, without loading credentials. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateRuntimeConfig } = await import('./config/runtime');
    try {
      const config = validateRuntimeConfig(process.env);
      if (config.deployment !== 'local') {
        const { validateSigningSecret } = await import('./config/deployment');
        validateSigningSecret(process.env);
      }
      const { serverServices } = await import('./server/services');
      void serverServices.features;
    } catch {
      throw new Error(
        'Invalid runtime configuration. Check deployment settings.'
      );
    }
  }
}
