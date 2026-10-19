/** Next.js adapter; detail contracts/handlers live in src/shares/server/detail.ts. */
export {
  dispatch as GET,
  dispatch as HEAD,
  dispatch as OPTIONS,
  dispatch as POST,
  dispatch as PUT,
  dispatch as PATCH,
  dispatch as DELETE
} from '../../../../shares/server/app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
