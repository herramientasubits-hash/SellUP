'use server';

/**
 * Configuración → Cotizador → Regiones: quién cotiza qué regiones.
 *
 * Solo admin. Escribe con la llave de servicio en `internal_user_quote_markets`
 * (migración 170). Las personas que ven todo por su rol aparecen en la lista
 * pero no se les asigna nada.
 */
import { revalidatePath } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { QUOTE_MARKETS, isQuoteMarket, type QuoteMarket } from './markets';
import { applyMarketAssignment, seesAllQuoteMarkets, type MarketAssignmentMode } from './quote-access';
import { QUOTE_MARKETS_TABLE } from './quote-markets.server';

export interface QuoteMarketAssignmentRow {
  userId: string;
  name: string;
  email: string;
  roleKey: string | null;
  /** Ve todas las regiones por su rol: no se le asigna nada. */
  seesAll: boolean;
  markets: QuoteMarket[];
}

export type QuoteMarketAssignments =
  | { ok: true; rows: QuoteMarketAssignmentRow[] }
  | { ok: false; reason: 'forbidden' | 'missing_table' | 'error' };

/** Las personas activas con sus regiones. */
export async function getQuoteMarketAssignments(): Promise<QuoteMarketAssignments> {
  if (!(await isCurrentUserAdmin())) return { ok: false, reason: 'forbidden' };
  const admin = createSupabaseAdminClient();
  const [usersResult, rolesResult, marketsResult] = await Promise.all([
    admin
      .from('internal_users')
      .select('id, email, full_name, role_id')
      .eq('access_status', 'active')
      .order('full_name', { ascending: true }),
    admin.from('roles').select('id, key'),
    admin.from(QUOTE_MARKETS_TABLE).select('user_id, market'),
  ]);
  if (marketsResult.error) {
    console.error('[quote-markets] lectura:', marketsResult.error);
    // 42P01 = la tabla no existe: falta aplicar la migración 170.
    return { ok: false, reason: marketsResult.error.code === '42P01' ? 'missing_table' : 'error' };
  }
  if (usersResult.error || rolesResult.error) {
    console.error('[quote-markets] usuarios:', usersResult.error ?? rolesResult.error);
    return { ok: false, reason: 'error' };
  }

  const roleKeyById = new Map((rolesResult.data ?? []).map((role) => [role.id as string, role.key as string]));
  const marketsByUser = new Map<string, QuoteMarket[]>();
  for (const row of marketsResult.data ?? []) {
    if (!isQuoteMarket(row.market)) continue;
    const list = marketsByUser.get(row.user_id as string) ?? [];
    list.push(row.market);
    marketsByUser.set(row.user_id as string, list);
  }

  const rows = (usersResult.data ?? []).map((user) => {
    const roleKey = user.role_id ? (roleKeyById.get(user.role_id as string) ?? null) : null;
    const assigned = marketsByUser.get(user.id as string) ?? [];
    return {
      userId: user.id as string,
      name: (user.full_name as string | null) || (user.email as string),
      email: user.email as string,
      roleKey,
      seesAll: seesAllQuoteMarkets({ isAdmin: roleKey === 'admin', roleKey }),
      markets: QUOTE_MARKETS.filter((market) => assigned.includes(market)),
    };
  });
  return { ok: true, rows };
}

export interface SetQuoteMarketsInput {
  userIds: string[];
  markets: string[];
  mode: MarketAssignmentMode;
}

export type SetQuoteMarketsResult = { ok: true; updated: number } | { ok: false; error: string };

const MODES: readonly MarketAssignmentMode[] = ['add', 'remove', 'replace'];
const MAX_USERS_PER_CHANGE = 500;

/** Agrega, quita o reemplaza regiones a una o varias personas. */
export async function setQuoteMarkets(input: SetQuoteMarketsInput): Promise<SetQuoteMarketsResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: 'Solo un admin asigna regiones.' };
  if (!MODES.includes(input.mode)) return { ok: false, error: 'Cambio no válido.' };
  const userIds = [...new Set((input.userIds ?? []).filter((id) => typeof id === 'string' && id.length > 0))];
  if (userIds.length === 0) return { ok: false, error: 'Elige al menos una persona.' };
  if (userIds.length > MAX_USERS_PER_CHANGE) return { ok: false, error: `Máximo ${MAX_USERS_PER_CHANGE} personas por cambio.` };
  if (!(input.markets ?? []).every(isQuoteMarket)) return { ok: false, error: 'Alguna región no existe.' };
  const markets = input.markets as QuoteMarket[];
  if (markets.length === 0 && input.mode !== 'replace') return { ok: false, error: 'Elige al menos una región.' };

  const admin = createSupabaseAdminClient();
  const actor = await getCurrentUser();

  const { data: activeUsers, error: usersError } = await admin
    .from('internal_users')
    .select('id')
    .in('id', userIds)
    .eq('access_status', 'active');
  if (usersError) return { ok: false, error: 'No se pudo leer la lista de personas. Inténtalo de nuevo.' };
  const activeIds = new Set((activeUsers ?? []).map((row) => row.id as string));
  if (userIds.some((id) => !activeIds.has(id))) {
    return { ok: false, error: 'Alguna persona ya no está activa. Recarga la lista.' };
  }

  const { data: currentRows, error: readError } = await admin
    .from(QUOTE_MARKETS_TABLE)
    .select('user_id, market')
    .in('user_id', userIds);
  if (readError) return { ok: false, error: 'No se pudieron leer las regiones actuales. Inténtalo de nuevo.' };

  const current = new Map<string, QuoteMarket[]>(userIds.map((id) => [id, []]));
  for (const row of currentRows ?? []) {
    if (isQuoteMarket(row.market)) current.get(row.user_id as string)?.push(row.market);
  }

  const toInsert: { user_id: string; market: QuoteMarket; assigned_by: string | null }[] = [];
  const toDelete: { userId: string; markets: QuoteMarket[] }[] = [];
  for (const userId of userIds) {
    const before = current.get(userId) ?? [];
    const after = applyMarketAssignment(before, markets, input.mode);
    for (const market of after) {
      if (!before.includes(market)) toInsert.push({ user_id: userId, market, assigned_by: actor?.id ?? null });
    }
    const removed = before.filter((market) => !after.includes(market));
    if (removed.length > 0) toDelete.push({ userId, markets: removed });
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from(QUOTE_MARKETS_TABLE).upsert(toInsert, { onConflict: 'user_id,market', ignoreDuplicates: true });
    if (error) {
      console.error('[quote-markets] alta:', error);
      return { ok: false, error: 'No se pudieron guardar las regiones. Inténtalo de nuevo.' };
    }
  }
  for (const { userId, markets: removed } of toDelete) {
    const { error } = await admin.from(QUOTE_MARKETS_TABLE).delete().eq('user_id', userId).in('market', removed);
    if (error) {
      console.error('[quote-markets] baja:', error);
      return { ok: false, error: 'No se pudieron quitar algunas regiones. Recarga y revisa.' };
    }
  }

  revalidatePath('/settings/quotes');
  revalidatePath('/quotes');
  return { ok: true, updated: userIds.length };
}
