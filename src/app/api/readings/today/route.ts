import { dispatch } from '../../../../shares/server/app';
export const runtime = 'nodejs';
/** Public reading requests do not create a private session. */
export const GET = dispatch;
export const HEAD = dispatch;
export const OPTIONS = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
