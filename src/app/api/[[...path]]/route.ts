import { dispatch } from '../../../server/app';

export const runtime = 'nodejs';

/** Next may proxy Requests. Transfer public fields explicitly so Fetch brand checks never inspect that proxy. */
const handle = (request: Request) =>
  dispatch(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      duplex: 'half'
    } as RequestInit)
  );

// Hono owns API paths, validation and method contracts; Next provides one hosting adapter.
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
