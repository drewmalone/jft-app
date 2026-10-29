import { z } from 'zod';

/** The relay owns xAI's wire protocol. Browsers receive only ordered application events. */
export const relayEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('interim'), text: z.string().max(20_000) }),
  z.object({ type: z.literal('final'), text: z.string().max(20_000) }),
  z.object({ type: z.literal('ended') }),
  z.object({ type: z.literal('error') })
]);
