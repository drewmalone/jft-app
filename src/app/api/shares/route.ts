/** Next.js entry for the OpenAPI-defined share resource; see docs/API.md. */
export {
  dispatch as GET,
  dispatch as POST,
  dispatch as HEAD,
  dispatch as OPTIONS,
  dispatch as PUT,
  dispatch as PATCH,
  dispatch as DELETE
} from '../../../shares/server/app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
