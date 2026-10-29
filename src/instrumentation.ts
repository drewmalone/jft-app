/** Validate nonsecret deployment selection when the Node server starts; never load keys at build time. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { transcriptionProvider } =
      await import('./shares/server/transcription-config');
    if (transcriptionProvider() === 'xai') {
      const { xaiRelayConfiguration } =
        await import('./shares/server/providers/xai/session');
      xaiRelayConfiguration();
    }
  }
}
