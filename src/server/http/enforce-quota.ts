import 'server-only';
import type { QuotaOperation } from '../../config/quotas';
import { QuotaExceeded } from '../abuse/quotas';
import { securityMetric } from '../abuse/security-metrics';
import { serverServices } from '../services';
import { QuotaHttpError } from './quota-error';
import { error } from './errors';

/** Only the HTTP boundary translates domain failures into responses. Private reads tolerate outages. */
export async function enforceQuota(operation: QuotaOperation, owner: string) {
  try {
    await serverServices.quotas.check(operation, owner);
    securityMetric(operation, 'allowed');
  } catch (cause) {
    if (cause instanceof QuotaExceeded) {
      securityMetric(operation, 'limited');
      throw new QuotaHttpError(429, {
        res: error('RATE_LIMITED', { 'Retry-After': String(cause.retryAfter) })
      });
    }
    securityMetric(operation, 'unavailable');
    if (operation === 'private') return;
    throw new QuotaHttpError(503, {
      res: error(
        operation === 'transcription'
          ? 'TRANSCRIPTION_UNAVAILABLE'
          : operation === 'cleanup'
            ? 'CLEANUP_UNAVAILABLE'
            : 'INTERNAL_ERROR'
      )
    });
  }
}
