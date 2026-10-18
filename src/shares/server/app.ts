import 'server-only';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { parse as parseContentType } from 'content-type';
import { shareSchema } from '../model';
import { shareRepository } from './repository';
import { getSession, setSessionCookie, InvalidSessionError } from './session';
import { error, MAX_SHARE_REQUEST_BYTES } from './http';
import {
  collectionAllow,
  detailAllow,
  createShareRoute,
  listSharesRoute,
  readShareRoute,
  protocolRoutes,
  openApiConfiguration
} from './openapi';

type SessionEnvironment = { Variables: { ownerId: string } };
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
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'private, no-store');
});

const anonymousSession: MiddlewareHandler<SessionEnvironment> = async (
  c,
  next
) => {
  const methods =
    c.req.path === '/api/shares' ? ['GET', 'HEAD', 'POST'] : ['GET', 'HEAD'];
  if (!methods.includes(c.req.method)) return next();
  const session = getSession(c.req.raw);
  c.set('ownerId', session.ownerId);
  await next();
  // Validation responses may issue a cookie; internal failures must not establish one.
  if (c.res.status < 500) setSessionCookie(c.res, session.credential);
};
app.use('/shares', anonymousSession);
app.use('/shares/:id', anonymousSession);

app.use('/shares', async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const origin = c.req.header('origin');
  const url = new URL(c.req.url);
  const authority = c.req.header('host') ?? url.host;
  if (origin && origin !== `${url.protocol}//${authority}`)
    return error('CROSS_ORIGIN_REQUEST');
  try {
    if (
      parseContentType(c.req.header('content-type') ?? '').type !==
      'application/json'
    )
      return error('UNSUPPORTED_MEDIA_TYPE');
  } catch {
    return error('UNSUPPORTED_MEDIA_TYPE');
  }
  // Canonicalize a valid media type for the OpenAPI validator. Force bodyLimit to
  // count actual bytes rather than trusting a potentially incorrect Content-Length.
  const headers = new Headers(c.req.raw.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  c.req.raw = new Request(c.req.raw, { headers });
  return bodyLimit({
    maxSize: MAX_SHARE_REQUEST_BYTES,
    onError: () => error('PAYLOAD_TOO_LARGE')
  })(c, next);
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
  if (!share) throw new HTTPException(404);
  return c.json(shareSchema.parse(share), 200);
});
app.options('/shares', (c) =>
  c.newResponse(null, 204, { Allow: collectionAllow })
);
app.options('/shares/:id', (c) =>
  c.newResponse(null, 204, { Allow: detailAllow })
);
for (const route of protocolRoutes) app.openAPIRegistry.registerPath(route);
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
  return app.fetch(request);
}

/**
 * Generates the OpenAPI 3.1 contract from the same Zod route definitions used at runtime.
 * @returns Public schema/HTTP metadata only; never includes live records or credentials.
 * @throws If the OpenAPI library cannot represent a registered schema.
 */
export function getOpenApiDocument() {
  return app.getOpenAPI31Document(openApiConfiguration);
}
