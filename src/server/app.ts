import { registerSession } from '../session/server/bootstrap';
import { registerDailyReading } from '../readings/server/http/read-daily-reading';
import 'server-only';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { SessionEnvironment } from './http/middleware';
import { error, handleApiError } from './http/errors';
import {
  createShareRoute,
  createShare
} from '../shares/server/http/operations/create-share';
import {
  listSharesRoute,
  listShares
} from '../shares/server/http/operations/list-shares';
import {
  readShareRoute,
  readShare
} from '../shares/server/http/operations/read-share';
import { registerResourceMethods } from '../shares/server/http/resource-methods';
import { openApiConfiguration } from './http/openapi';

import {
  readPublicShareRoute,
  getPublicShare,
  publicShareValidation
} from '../shares/server/http/operations/read-public-share';

import {
  transcriptionSessionRoute,
  createTranscriptionSession
} from '../shares/server/http/operations/transcription-session';

import {
  cleanShareRoute,
  cleanShare
} from '../shares/server/http/operations/clean-share';
import { optionsRoute } from './http/openapi';

const specificationAllow = 'GET, HEAD, OPTIONS';

const app = new OpenAPIHono<SessionEnvironment>({
  defaultHook: (result) => {
    if (!result.success)
      return error(
        result.target === 'query'
          ? 'INVALID_HISTORY_QUERY'
          : result.target === 'header'
            ? 'INVALID_IDEMPOTENCY_KEY'
            : 'INVALID_SHARE'
      );
  }
}).basePath('/api');

app.onError(handleApiError);
registerDailyReading(app);
registerSession(app);
app.openapi(listSharesRoute, listShares);
app.openapi(createShareRoute, createShare);

app.openapi(readPublicShareRoute, getPublicShare, publicShareValidation);
app.openapi(transcriptionSessionRoute, createTranscriptionSession);
app.openapi(
  optionsRoute(
    '/transcription/session',
    'POST, OPTIONS',
    'transcriptionOptions',
    'Transcription'
  ),
  (c) => c.body(null, 204, { Allow: 'POST, OPTIONS' })
);
app.all('/transcription/session', () =>
  error('METHOD_NOT_ALLOWED', { Allow: 'POST, OPTIONS' })
);
app.openapi(cleanShareRoute, cleanShare);
app.openapi(
  optionsRoute('/shares/cleanup', 'POST, OPTIONS', 'cleanupOptions'),
  (c) => c.body(null, 204, { Allow: 'POST, OPTIONS' })
);
app.all('/shares/cleanup', () =>
  error('METHOD_NOT_ALLOWED', { Allow: 'POST, OPTIONS' })
);
app.openapi(readShareRoute, readShare);
registerResourceMethods(app);
app.openAPIRegistry.registerComponent('securitySchemes', 'AnonymousSession', {
  type: 'apiKey',
  in: 'cookie',
  name: 'doorknob-session',
  description:
    'Signed HttpOnly cookie, 30-day absolute expiry, SameSite=Lax, Secure in production. Share operations may establish a fresh owner for missing/invalid/expired cookies; paid operations require an existing valid cookie and never issue one.'
});
app.options('/openapi.json', (c) =>
  c.newResponse(null, 204, { Allow: specificationAllow })
);
app.doc31('/openapi.json', openApiConfiguration);
app.all('/openapi.json', () =>
  error('METHOD_NOT_ALLOWED', { Allow: specificationAllow })
);
app.notFound(() => new Response(null, { status: 404 }));

/** Apply cache/privacy headers to every API response, including failures. */
export async function dispatch(request: Request): Promise<Response> {
  const response = await app.fetch(request);
  response.headers.set('Cache-Control', 'private, no-store');
  if (new URL(request.url).pathname.startsWith('/api/public/shares/')) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    response.headers.set('Referrer-Policy', 'no-referrer');
  }
  return response;
}

export function getOpenApiDocument() {
  return app.getOpenAPI31Document(openApiConfiguration);
}
