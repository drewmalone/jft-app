import { HTTPException } from 'hono/http-exception';
/** Only application-authored quota responses may cross the generic error boundary. */
export class QuotaHttpError extends HTTPException {}
