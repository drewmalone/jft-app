import 'server-only';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { z } from 'zod';
import { dailyReadingSchema } from '../../model';
import { DEFAULT_READING_TIME_ZONE, timeZoneSchema } from '../../calendar';
import {
  privateHeaders,
  failed,
  headRoute,
  optionsRoute
} from '../../../server/http/openapi';
import { error, errorBody } from '../../../server/http/errors';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { ApiEnvironment } from '../../../server/http/middleware';

export const dailyReadingRoute = createRoute({
  method: 'get',
  path: '/readings/today',
  operationId: 'readDailyReading',
  tags: ['Readings'],
  security: [],
  summary: 'Read today’s Just for Today text in the reader’s timezone',
  description:
    'No session required or issued. The server uses a bounded process-local cache by ISO date. A missing date returns reading: null; sample mode is explicit.',
  request: {
    query: z.object({
      timeZone: timeZoneSchema.default(DEFAULT_READING_TIME_ZONE)
    })
  },
  responses: {
    200: {
      description:
        'The requested local date and its reading, or null if no content is published for that date.',
      headers: { 'Cache-Control': privateHeaders['Cache-Control'] },
      content: { 'application/json': { schema: dailyReadingSchema } }
    },
    400: failed(['INVALID_READING_QUERY']),
    503: failed(['READING_UNAVAILABLE'])
  }
});
export const readDailyReading: RouteHandler<
  typeof dailyReadingRoute,
  ApiEnvironment
> = async (c) => {
  try {
    return c.json(
      await c.get('services').readings.today(c.req.valid('query').timeZone),
      200
    );
  } catch {
    return c.json(errorBody('READING_UNAVAILABLE'), 503);
  }
};
/** Register the public reading boundary without introducing anonymous sessions. */
export function registerDailyReading(app: OpenAPIHono<ApiEnvironment>) {
  app.openapi(dailyReadingRoute, readDailyReading, (result, c) => {
    if (!result.success) return c.json(errorBody('INVALID_READING_QUERY'), 400);
  });
  app.openAPIRegistry.registerPath(headRoute(dailyReadingRoute));
  app.openapi(
    optionsRoute(
      '/readings/today',
      'GET, HEAD, OPTIONS',
      'dailyReadingOptions',
      'Readings'
    ),
    (c) => c.body(null, 204, { Allow: 'GET, HEAD, OPTIONS' })
  );
  app.all('/readings/today', () =>
    error('METHOD_NOT_ALLOWED', { Allow: 'GET, HEAD, OPTIONS' })
  );
}
