import 'server-only';
import { serverServices } from '../../server/services';
/** Startup deployment selection; the browser receives only the validated provider name. */
export function transcriptionProvider() {
  return serverServices.features.transcription.provider;
}
