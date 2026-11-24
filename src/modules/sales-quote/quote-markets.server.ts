import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getAccessSnapshot } from '@/modules/access/capabilities.server';
import { resolveQuoteMarkets, seesAllQuoteMarkets, type QuoteMarketAccess } from './quote-access';

export const QUOTE_MARKETS_TABLE = 'internal_user_quote_markets';

export interface MyQuoteAccess extends QuoteMarketAccess {
  userId: string | null;
  isAdmin: boolean;
}

/**
 * Las regiones que puede cotizar quien está en sesión. Falla cerrado: si no se
 * pueden leer sus regiones (p. ej. la migración 170 aún no está aplicada), un
 * vendedor no cotiza nada; el admin y los líderes siguen viéndolo todo.
 */
export async function getMyQuoteAccess(): Promise<MyQuoteAccess> {
  const access = await getAccessSnapshot();
  const viewer = { isAdmin: access.isAdmin, roleKey: access.roleKey };
  if (!access.userId) return { userId: null, isAdmin: false, markets: [], seesAll: false };
  if (seesAllQuoteMarkets(viewer)) {
    return { userId: access.userId, isAdmin: access.isAdmin, ...resolveQuoteMarkets(viewer, []) };
  }
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from(QUOTE_MARKETS_TABLE)
      .select('market')
      .eq('user_id', access.userId);
    if (error) throw error;
    const assigned = (data ?? []).map((row) => row.market as unknown);
    return { userId: access.userId, isAdmin: access.isAdmin, ...resolveQuoteMarkets(viewer, assigned) };
  } catch (error) {
    console.error('[quote-markets] no se pudieron leer las regiones:', error);
    return { userId: access.userId, isAdmin: access.isAdmin, markets: [], seesAll: false };
  }
}
