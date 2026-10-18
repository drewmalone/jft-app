import 'server-only';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { SessionEnvironment } from './middleware';
import { shareSchema } from '../model';
import { shareRepository } from './repository';
import { InvalidSessionError } from './session';
import { HTTPException } from 'hono/http-exception';
import { error, apiFailures } from './http';
import {
  collectionAllow,
  detailAllow,
  createShareRoute,
  listSharesRoute,
  readShareRoute,
  headRoutes,
  collectionOptionsRoute,
  detailOptionsRoute,
  openApiConfiguration
} from './openapi';

const app = new OpenAPIHono<SessionEnvironment>({
  defaultHook: (result) => {
    if (!result.success) return error('INVALID_SHARE');
  }
}).basePath('/api');

app.onError((cause) => {
  if (cause instanceof InvalidSessionError) return error('INVALID_SESSION');
  if (cause instanceof HTTPException) {
    if (cause.status === 404) return error('SHARE_NOT_FOUND');
    if (cause.status === 400) return error('INVALID_JSON');
    if (cause.status === 415) return error('UNSUPPORTED_MEDIA_TYPE');
    if (cause.status === 413) return error('PAYLOAD_TOO_LARGE');
  }
  // No request bodies, cookie values, or raw exception details enter logs/responses.
  return error('INTERNAL_ERROR');
});
app.openapi(listSharesRoute, async (c) => {
  const shares = await shareRepository.listByOwner(c.get('ownerId'));
  return c.json(
    shares.map((share) => shareSchema.parse(share)),
    200
  );
});
app.openapi(createShareRoute, async (c) => {
  const { text } = c.req.valid('json');
  const share = await shareRepository.create(c.get('ownerId'), text);
  c.header('Location', `/api/shares/${share.id}`);
  return c.json(shareSchema.parse(share), 201);
});
app.openapi(readShareRoute, async (c) => {
  const { id } = c.req.valid('param');
  const share = await shareRepository.findByOwner(id, c.get('ownerId'));
  if (!share)
    return c.json(
      {
        error: {
          code: 'SHARE_NOT_FOUND' as const,
          message: apiFailures.SHARE_NOT_FOUND.message
        }
      },
      404
    );
  return c.json(shareSchema.parse(share), 200);
});
app.openapi(collectionOptionsRoute, (c) =>
  c.body(null, 204, { Allow: collectionAllow })
);
app.openapi(detailOptionsRoute, (c) =>
  c.body(null, 204, { Allow: detailAllow })
);
for (const route of headRoutes) app.openAPIRegistry.registerPath(route);
app.openAPIRegistry.registerComponent('securitySchemes', 'AnonymousSession', {
  type: 'apiKey',
  in: 'cookie',
  name: 'doorknob-session',
  description:
    'Signed HttpOnly cookie. No cookie bootstraps a new owner; invalid supplied credentials are rejected. 30-day absolute expiry, SameSite=Lax, Secure in production. Custom WWW-Authenticate scheme: DoorknobSession.'
});
app.options('/openapi.json', (c) =>
  c.newResponse(null, 204, { Allow: detailAllow })
);
app.doc31('/openapi.json', openApiConfiguration);
app.all('/shares', () =>
  error('METHOD_NOT_ALLOWED', { Allow: collectionAllow })
);
app.all('/shares/:id', () =>
  error('METHOD_NOT_ALLOWED', { Allow: detailAllow })
);
app.all('/openapi.json', () =>
  error('METHOD_NOT_ALLOWED', { Allow: detailAllow })
);
app.notFound(() => new Response(null, { status: 404 }));

/**
 * Dispatches a Next.js Web Request through the OpenAPI-defined BFF.
 * @param request - Incoming share/spec request; session credentials remain in cookies.
 * @returns A Web Response; supported failures use stable codes and private/no-store.
 * HEAD reuses GET authorization/headers with no body. OPTIONS and unsupported methods
 * do not establish sessions; 405 includes Allow. Unexpected failures become generic 500.
 */
export async function dispatch(request: Request): Promise<Response> {
  const response = await app.fetch(request);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/**
 * Generates the OpenAPI 3.1 contract from the same Zod route definitions used at runtime.
 * @returns Public schema/HTTP metadata only; never includes live records or credentials.
 * @throws If the OpenAPI library cannot represent a registered schema.
 */
export function getOpenApiDocument() {
  return app.getOpenAPI31Document(openApiConfiguration);
}
