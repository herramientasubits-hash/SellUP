/**
 * Agente 3 · Primera llamada — validar lo que pide el navegador (puro).
 */

import { z } from 'zod';
import { FIRST_CALL_CHANNELS, FIRST_CALL_GOALS, type FirstCallRequest } from '@/server/agents/first-call/types';
import { UBITS_PRODUCTS } from '@/server/agents/first-call/ubits-messaging-library';

const productKeys = UBITS_PRODUCTS.map((p) => p.key) as [string, ...string[]];

const requestSchema = z.object({
  accountId: z.uuid(),
  contactId: z.uuid().nullable().default(null),
  channel: z.enum(FIRST_CALL_CHANNELS as unknown as [string, ...string[]]),
  goal: z.enum(FIRST_CALL_GOALS as unknown as [string, ...string[]]).default('book_meeting'),
  productFocus: z.enum(productKeys).nullable().default(null),
  refreshResearch: z.boolean().default(false),
  regenerateFromPackId: z.uuid().nullable().default(null),
  regenerationReason: z.string().trim().max(300).nullable().default(null),
});

export type ParsedFirstCallRequest = { ok: true; request: FirstCallRequest } | { ok: false; error: string };

export function parseFirstCallRequest(body: unknown): ParsedFirstCallRequest {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'invalid_request' };
  const data = parsed.data;
  return {
    ok: true,
    request: {
      accountId: data.accountId,
      contactId: data.contactId,
      channel: data.channel as FirstCallRequest['channel'],
      goal: data.goal as FirstCallRequest['goal'],
      productFocus: data.productFocus,
      refreshResearch: data.refreshResearch,
      regenerateFromPackId: data.regenerateFromPackId,
      regenerationReason: data.regenerationReason && data.regenerationReason.length > 0 ? data.regenerationReason : null,
    },
  };
}
