import 'server-only';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { sameOrigin, type SessionEnvironment } from '../middleware';
import { getSession, InvalidSessionError, setSessionCookie } from '../session';
import { failed, privateHeaders } from '../openapi';

/** Explicit recovery: replace rejected credentials, without silently changing a valid owner. */
export const resetSessionRoute = createRoute({
  method: 'post',
  path: '/session/reset',
  operationId: 'resetSession',
  tags: ['Shares'],
  summary: 'Recover an invalid anonymous session',
  description:
    'Explicit same-origin recovery after credential rejection. Missing or invalid credentials receive a fresh session; valid sessions remain unchanged. No shares are read, migrated, or deleted, and prior ownership cannot be recovered. No request body is needed.',
  security: [],
  middleware: [sameOrigin] as const,
  responses: {
    204: {
      description:
        'Session ready. A new HttpOnly cookie replaces missing or invalid credentials only.',
      headers: privateHeaders
    },
    403: failed(['CROSS_ORIGIN_REQUEST']),
    500: failed(['INTERNAL_ERROR'])
  }
});

/**
 * Recovers only explicit credential failures. Configuration errors fail closed.
 * @param c - Origin-checked context; neither request bodies nor client owner IDs are trusted.
 * @returns Bodyless 204 with a new cookie only if credentials need replacing.
 * @throws On configuration or cookie-signing failure; dispatcher returns generic 500.
 */
export const resetSession: RouteHandler<
  typeof resetSessionRoute,
  SessionEnvironment
> = async (c) => {
  let session;
  try {
    session = await getSession(c.req.raw);
  } catch (cause) {
    if (!(cause instanceof InvalidSessionError)) throw cause;
    // Deliberately omit the rejected cookie only on this explicit recovery operation.
    session = await getSession(new Request(c.req.url));
  }
  const response = c.body(null, 204);
  await setSessionCookie(response, session.newSession);
  return response;
};
