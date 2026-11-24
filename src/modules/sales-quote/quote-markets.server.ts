import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { groupPathNames, resolveQuoteMarkets, seesAllQuoteMarkets, type GroupRow, type QuoteMarketAccess } from './quote-access';

export interface MyQuoteAccess extends QuoteMarketAccess {
  userId: string | null;
  isAdmin: boolean;
}

const NO_ACCESS: MyQuoteAccess = { userId: null, isAdmin: false, markets: [], seesAll: false, fromGroup: null };

/**
 * Las regiones que puede cotizar quien está en sesión, según su grupo de
 * SellUp. Falla cerrado: si no se puede leer el grupo, un vendedor no cotiza
 * nada; el admin y los líderes siguen viéndolo todo.
 */
export async function getMyQuoteAccess(): Promise<MyQuoteAccess> {
  try {
    const [user, isAdmin] = await Promise.all([getCurrentUser(), isCurrentUserAdmin()]);
    if (!user || user.access_status !== 'active') return NO_ACCESS;
    const viewer = { isAdmin, roleKey: user.role_key ?? null };
    if (seesAllQuoteMarkets(viewer)) {
      return { userId: user.id, isAdmin, ...resolveQuoteMarkets(viewer, []) };
    }
    // `get_internal_user` no trae el grupo: se lee aparte.
    const admin = createSupabaseAdminClient();
    const [membership, groups] = await Promise.all([
      admin.from('internal_users').select('group_id').eq('id', user.id).maybeSingle(),
      admin.from('organization_groups').select('id, name, parent_group_id'),
    ]);
    if (membership.error) throw membership.error;
    if (groups.error) throw groups.error;
    const groupId = (membership.data?.group_id as string | null | undefined) ?? null;
    const path = groupPathNames(groupId, (groups.data ?? []) as GroupRow[]);
    return { userId: user.id, isAdmin, ...resolveQuoteMarkets(viewer, path) };
  } catch (error) {
    console.error('[quotes] no se pudo leer la región de la persona:', error);
    return NO_ACCESS;
  }
}
