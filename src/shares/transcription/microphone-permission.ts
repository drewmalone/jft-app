import { speechDiagnostic, speechErrorCode } from './diagnostics';

export const MICROPHONE_DENIED =
  'Microphone access was denied or blocked. In Safari, open this website’s settings and set Microphone to Allow, then try again. In other browsers, check site permissions.';

export function microphoneErrorMessage(code: string): string {
  switch (code) {
    case 'NotAllowedError':
      return MICROPHONE_DENIED;
    case 'NotFoundError':
    case 'NotReadableError':
    case 'OverconstrainedError':
      return 'Microphone unavailable. Check that a microphone is connected and another app is not using it, then try again.';
    case 'SecurityError':
      return 'Microphone access is blocked by browser security settings. Open this site over HTTPS and check site permissions.';
    case 'NotSupportedError':
      return 'This browser cannot request microphone access. Try a current version of Safari or Chrome.';
    default:
      return 'Microphone access could not start. Check your microphone and try again.';
  }
}

/** Per-editor permission gate, independent of the chosen transcription provider.
 * Only request() touches capture APIs; call it directly from a user action.
 * No stream escapes this module, and no audio is stored or uploaded.
 */
export function createMicrophonePermission() {
  let granted = false;
  let revision = 0;
  let pending: Promise<void> | undefined;
  const fail = (cause: unknown): never => {
    const code = speechErrorCode(
      typeof cause === 'object' && cause !== null && 'name' in cause
        ? cause.name
        : undefined
    );
    speechDiagnostic(
      code === 'NotAllowedError'
        ? 'microphone-permission-denied'
        : 'microphone-permission-failed',
      { code }
    );
    throw new Error(microphoneErrorMessage(code));
  };
  return {
    reset() {
      granted = false;
      revision++;
    },
    request(): void | Promise<void> {
      if (pending) return pending;
      if (granted) return;
      if (typeof window === 'undefined' || !window.isSecureContext) {
        speechDiagnostic('microphone-unavailable', { code: 'SecurityError' });
        throw new Error(microphoneErrorMessage('SecurityError'));
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        speechDiagnostic('microphone-api-unavailable');
        throw new Error(microphoneErrorMessage('NotSupportedError'));
      }
      const requestedRevision = revision;
      speechDiagnostic('microphone-permission-request', {
        userActivation: navigator.userActivation?.isActive
      });
      // Invoke synchronously in the click handler, before any await/query.
      try {
        pending = navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            for (const track of stream.getTracks()) {
              try {
                track.stop();
              } catch {
                // One failing track must not prevent stopping the others.
              }
            }
            granted = requestedRevision === revision;
            speechDiagnostic('microphone-permission-granted');
          })
          .catch(fail)
          .finally(() => {
            pending = undefined;
          });
        return pending;
      } catch (cause) {
        fail(cause);
      }
    }
  };
}

export type MicrophonePermission = ReturnType<
  typeof createMicrophonePermission
>;
