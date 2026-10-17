/**
 * Agente 3 · Primer contacto — validar lo que pide el navegador (puro).
 *
 * Acepta la forma nueva (varios decisores, canales y productos) y la de la v1
 * (`contactId`, `channel`, `productFocus`), que siguen mandando las pestañas abiertas.
 */

import { z } from 'zod';
import {
  FIRST_CALL_CHANNELS,
  FIRST_CALL_GOALS,
  MAX_CONTACTS_PER_RUN,
  type FirstCallChannel,
  type FirstCallRequest,
} from '@/server/agents/first-call/types';
import { UBITS_PRODUCTS } from '@/server/agents/first-call/ubits-messaging-library';

const productKeys = UBITS_PRODUCTS.map((p) => p.key) as [string, ...string[]];
const channelEnum = z.enum(FIRST_CALL_CHANNELS as unknown as [string, ...string[]]);

const requestSchema = z.object({
  accountId: z.uuid(),
  contactIds: z.array(z.uuid()).max(MAX_CONTACTS_PER_RUN).optional(),
  contactId: z.uuid().nullable().optional(),
  channels: z.array(channelEnum).min(1).max(FIRST_CALL_CHANNELS.length).optional(),
  channel: channelEnum.optional(),
  goal: z.enum(FIRST_CALL_GOALS as unknown as [string, ...string[]]).default('book_meeting'),
  productKeys: z.array(z.enum(productKeys)).max(productKeys.length).optional(),
  productFocus: z.enum(productKeys).nullable().optional(),
  refreshResearch: z.boolean().default(false),
  regenerateFromPackId: z.uuid().nullable().default(null),
  regenerationReason: z.string().trim().max(300).nullable().default(null),
});

export type ParsedFirstCallRequest = { ok: true; request: FirstCallRequest } | { ok: false; error: string };

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function parseFirstCallRequest(body: unknown): ParsedFirstCallRequest {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'invalid_request' };
  const data = parsed.data;
  const channels = unique(data.channels ?? (data.channel ? [data.channel] : [])) as FirstCallChannel[];
  if (channels.length === 0) return { ok: false, error: 'invalid_request' };
  const contactIds = unique(data.contactIds ?? (data.contactId ? [data.contactId] : []));
  const products = unique(data.productKeys ?? (data.productFocus ? [data.productFocus] : []));
  return {
    ok: true,
    request: {
      accountId: data.accountId,
      contactIds,
      channels,
      goal: data.goal as FirstCallRequest['goal'],
      productKeys: products,
      refreshResearch: data.refreshResearch,
      regenerateFromPackId: data.regenerateFromPackId,
      regenerationReason: data.regenerationReason && data.regenerationReason.length > 0 ? data.regenerationReason : null,
    },
  };
}
