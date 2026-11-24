'use server';

// ============================================================
// Cotizador — guardar, pedir aprobación, decidir y listar.
// ============================================================
// Todo pasa por el servidor con la llave de servicio (tablas de la 170, sin RLS
// para la sesión). Cada acción comprueba la sesión, la región de quien cotiza y,
// para decidir, que sea aprobador del tipo de cuenta o admin. Lo que se guarda
// es siempre el cálculo del servidor (`buildQuoteRecord`).

import { revalidatePath } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getCurrentActiveUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { resolveCommercialScope } from '@/modules/access/commercial-scope';
import { TEAM_ROLE_KEYS } from '@/modules/access/commercial-scope-logic';
import { ACCOUNT_TYPES, type QuoteAccountType } from './approval-draft';
import { QUOTE_COUNTRIES_2026 } from './engine-2026';
import { QUOTE_COUNTRIES, findQuoteCountry } from './markets';
import { canQuoteCountry } from './quote-access';
import {
  QUOTES_PATH,
  canDecideQuotes,
  notifyQuoteApprovalRequested,
  notifyQuoteDecision,
  resolveQuoteApprovers,
  type PersonRef,
} from './quote-approvals.server';
import { getMyQuoteAccess } from './quote-markets.server';
import { buildQuoteRecord, initialQuoteStatus, type QuoteStatus, type StoredQuoteResult } from './quote-record';
import { availablePricingVersions, type PricingVersion } from './version';

const nameOf = (user: { full_name?: string | null; email?: string | null } | null | undefined) =>
  user?.full_name || user?.email || 'Alguien';

function cleanNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

// ── Guardar ──────────────────────────────────────────────────────────────────

export type SaveQuoteResult =
  | { ok: true; id: string; status: QuoteStatus; approverNames: string[] }
  | { ok: false; error: string };

export async function saveSalesQuote(payload: unknown): Promise<SaveQuoteResult> {
  const access = await getMyQuoteAccess();
  const me = await getCurrentActiveUser();
  if (!access.userId || !me) return { ok: false, error: 'Tu sesión expiró o tu acceso no está activo.' };

  const built = buildQuoteRecord(payload);
  if (!built.ok) return { ok: false, error: built.error };
  const record = built.record;

  if (!availablePricingVersions().includes(record.version)) {
    return { ok: false, error: 'La versión 2026 ya no se cotiza: usa la 2027.' };
  }
  const countries = record.version === '2026' ? QUOTE_COUNTRIES_2026 : QUOTE_COUNTRIES;
  if (!canQuoteCountry(access, record.countryCode, countries)) {
    return { ok: false, error: 'Ese país no es de tu región. Pide a un admin que revise tu grupo.' };
  }

  // La empresa (opcional) tiene que ser una que la persona puede ver.
  if (record.accountId) {
    const supabase = await createClient();
    const { data: account } = await supabase.from('accounts').select('id').eq('id', record.accountId).maybeSingle();
    if (!account) return { ok: false, error: 'No encontramos esa empresa entre las tuyas. Elígela de nuevo.' };
  }

  const status = initialQuoteStatus(record);
  const admin = createSupabaseAdminClient();
  const { data: created, error } = await admin
    .from('sales_quotes')
    .insert({
      created_by: access.userId,
      account_id: record.accountId,
      client_name: record.clientName,
      pricing_version: record.version,
      country_code: record.countryCode,
      account_type: record.accountType,
      years: record.years,
      per_year_total: record.perYearTotal,
      contract_total: record.contractTotal,
      needs_approval: record.needsApproval,
      input: record.input,
      result: record.result,
      status,
    })
    .select('id')
    .single();
  if (error || !created) {
    console.error('[quotes] save failed:', error?.message.slice(0, 200));
    return {
      ok: false,
      error: error?.code === '42P01' ? 'Falta preparar la base de datos (migración 170). Avisa al equipo.' : 'No pudimos guardar la cotización. Vuelve a probar.',
    };
  }

  let approverNames: string[] = [];
  if (status === 'pending_approval') {
    approverNames = await notifyQuoteApprovalRequested(admin, {
      quoteId: created.id as string,
      requesterId: access.userId,
      requesterName: nameOf(me),
      accountType: record.accountType,
      clientName: record.clientName,
      countryName: findQuoteCountry(record.countryCode)?.name ?? record.countryCode,
      contractTotal: record.contractTotal,
      belowMinimumCount: record.result.lines.filter((line) => line.belowMinimum).length,
    });
  }

  revalidatePath(QUOTES_PATH);
  return { ok: true, id: created.id as string, status, approverNames };
}

// ── Cancelar una solicitud propia ────────────────────────────────────────────

export async function cancelSalesQuote(quoteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentActiveUser();
  if (!me) return { ok: false, error: 'Tu sesión expiró o tu acceso no está activo.' };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('sales_quotes')
    .update({ status: 'cancelled', decided_by: me.id, decided_at: new Date().toISOString() })
    .eq('id', quoteId)
    .eq('created_by', me.id)
    .eq('status', 'pending_approval')
    .select('id');
  if (error) return { ok: false, error: 'No pudimos cancelarla. Vuelve a probar.' };
  if (!data || data.length === 0) return { ok: false, error: 'Ya no está pendiente: alguien la decidió antes.' };
  revalidatePath(QUOTES_PATH);
  return { ok: true };
}

// ── Decidir ──────────────────────────────────────────────────────────────────

export async function decideSalesQuote(input: {
  quoteId: string;
  decision: 'approve' | 'reject';
  note?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const me = await getCurrentActiveUser();
  if (!me) return { success: false, error: 'Tu sesión expiró o tu acceso no está activo.' };
  if (input.decision !== 'approve' && input.decision !== 'reject') return { success: false, error: 'Decisión no válida.' };
  const isAdmin = await isCurrentUserAdmin();
  const admin = createSupabaseAdminClient();

  const { data: quote } = await admin
    .from('sales_quotes')
    .select('id, created_by, account_type, client_name, status')
    .eq('id', input.quoteId)
    .maybeSingle();
  if (!quote) return { success: false, error: 'No encontramos la cotización.' };
  if (quote.created_by === me.id) return { success: false, error: 'No puedes aprobar tu propia cotización.' };
  if (!(await canDecideQuotes(admin, me.id, isAdmin, quote.account_type as QuoteAccountType))) {
    return { success: false, error: 'No apruebas descuentos de este tipo de cuenta.' };
  }
  if (quote.status !== 'pending_approval') return { success: false, error: 'Esta cotización ya no está pendiente.' };

  const note = cleanNote(input.note);
  // Se cierra sólo si sigue pendiente: si otra persona la decidió un instante antes, no hay cambio.
  const { data: closed, error } = await admin
    .from('sales_quotes')
    .update({
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      decided_by: me.id,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq('id', quote.id)
    .eq('status', 'pending_approval')
    .select('id');
  if (error) return { success: false, error: 'No pudimos guardar la decisión. Vuelve a probar.' };
  if (!closed || closed.length === 0) return { success: false, error: 'Otra persona ya decidió esta cotización.' };

  await notifyQuoteDecision(admin, {
    quoteId: quote.id as string,
    requesterId: quote.created_by as string,
    approved: input.decision === 'approve',
    deciderName: nameOf(me),
    clientName: (quote.client_name as string | null) ?? null,
    note,
  });

  revalidatePath(QUOTES_PATH);
  return { success: true };
}

// ── Listar ───────────────────────────────────────────────────────────────────

export interface SalesQuoteRow {
  id: string;
  createdAt: string;
  createdById: string;
  createdByName: string;
  clientName: string | null;
  accountName: string | null;
  countryName: string;
  version: PricingVersion;
  accountType: QuoteAccountType;
  years: number;
  perYearTotal: number;
  contractTotal: number;
  status: QuoteStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  result: StoredQuoteResult;
  input: unknown;
}

export interface SalesQuotesBoard {
  mine: SalesQuoteRow[];
  /** Admin y líderes: las de su gente (sin las propias). `null` si no aplica. */
  team: SalesQuoteRow[] | null;
  /** Pendientes que esta persona puede decidir. */
  toDecide: SalesQuoteRow[];
  /** Puede aprobar algún tipo de cuenta (ve la pestaña «Por aprobar»). */
  canApprove: boolean;
  /** Las tablas aún no existen (falta la migración 170). */
  storageMissing: boolean;
}

const QUOTE_COLUMNS =
  'id, created_at, created_by, client_name, account_id, pricing_version, country_code, account_type, years, per_year_total, contract_total, status, decided_by, decided_at, decision_note, result, input';

interface QuoteDbRow {
  id: string;
  created_at: string;
  created_by: string;
  client_name: string | null;
  account_id: string | null;
  pricing_version: PricingVersion;
  country_code: string;
  account_type: QuoteAccountType;
  years: number;
  per_year_total: number | string;
  contract_total: number | string;
  status: QuoteStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  result: StoredQuoteResult;
  input: unknown;
}

const EMPTY_BOARD: SalesQuotesBoard = { mine: [], team: null, toDecide: [], canApprove: false, storageMissing: false };
const LIST_LIMIT = 50;

export async function getSalesQuotesBoard(): Promise<SalesQuotesBoard> {
  const me = await getCurrentActiveUser();
  if (!me) return EMPTY_BOARD;
  const isAdmin = await isCurrentUserAdmin();
  const admin = createSupabaseAdminClient();

  const mineResult = await admin
    .from('sales_quotes')
    .select(QUOTE_COLUMNS)
    .eq('created_by', me.id)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (mineResult.error) {
    if (mineResult.error.code === '42P01') return { ...EMPTY_BOARD, storageMissing: true };
    console.error('[quotes] board:', mineResult.error.message.slice(0, 200));
    return EMPTY_BOARD;
  }

  // Lo que puede decidir: por tipo de cuenta.
  const decidableTypes: QuoteAccountType[] = [];
  for (const accountType of ACCOUNT_TYPES) {
    if (await canDecideQuotes(admin, me.id, isAdmin, accountType)) decidableTypes.push(accountType);
  }
  const pendingResult = decidableTypes.length
    ? await admin
        .from('sales_quotes')
        .select(QUOTE_COLUMNS)
        .eq('status', 'pending_approval')
        .in('account_type', decidableTypes)
        .neq('created_by', me.id)
        .order('created_at')
        .limit(LIST_LIMIT)
    : { data: [] as QuoteDbRow[] };

  // Las de su gente: admin, todas; manager y líder, su equipo en cascada.
  let teamRows: QuoteDbRow[] | null = null;
  const isTeamRole = (TEAM_ROLE_KEYS as readonly string[]).includes(me.role_key ?? '');
  if (isAdmin || isTeamRole) {
    const scope = isAdmin ? null : await resolveCommercialScope().catch(() => null);
    const teamIds = scope && !scope.canViewAll ? scope.allowedUserIds.filter((id) => id !== me.id) : null;
    if (isAdmin || scope?.canViewAll || (teamIds && teamIds.length > 0)) {
      let query = admin.from('sales_quotes').select(QUOTE_COLUMNS).neq('created_by', me.id).order('created_at', { ascending: false }).limit(LIST_LIMIT);
      if (teamIds && !isAdmin && !scope?.canViewAll) query = query.in('created_by', teamIds);
      teamRows = ((await query).data ?? []) as QuoteDbRow[];
    } else {
      teamRows = [];
    }
  }

  const all = [...((mineResult.data ?? []) as QuoteDbRow[]), ...((pendingResult.data ?? []) as QuoteDbRow[]), ...(teamRows ?? [])];
  const userIds = [...new Set(all.flatMap((row) => [row.created_by, row.decided_by]).filter(Boolean))] as string[];
  const accountIds = [...new Set(all.map((row) => row.account_id).filter(Boolean))] as string[];
  const [usersResult, accountsResult] = await Promise.all([
    userIds.length ? admin.from('internal_users').select('id, full_name, email').in('id', userIds) : Promise.resolve({ data: [] }),
    accountIds.length ? admin.from('accounts').select('id, name').in('id', accountIds) : Promise.resolve({ data: [] }),
  ]);
  const users = new Map(((usersResult.data ?? []) as Array<{ id: string; full_name: string | null; email: string }>).map((user) => [user.id, user]));
  const accounts = new Map(((accountsResult.data ?? []) as Array<{ id: string; name: string }>).map((account) => [account.id, account.name]));

  const toRow = (row: QuoteDbRow): SalesQuoteRow => ({
    id: row.id,
    createdAt: row.created_at,
    createdById: row.created_by,
    createdByName: nameOf(users.get(row.created_by)),
    clientName: row.client_name,
    accountName: row.account_id ? (accounts.get(row.account_id) ?? null) : null,
    countryName: findQuoteCountry(row.country_code)?.name ?? row.country_code,
    version: row.pricing_version,
    accountType: row.account_type,
    years: row.years,
    perYearTotal: Number(row.per_year_total),
    contractTotal: Number(row.contract_total),
    status: row.status,
    decidedByName: row.decided_by ? nameOf(users.get(row.decided_by)) : null,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    result: row.result,
    input: row.input,
  });

  return {
    mine: ((mineResult.data ?? []) as QuoteDbRow[]).map(toRow),
    team: teamRows ? teamRows.map(toRow) : null,
    toDecide: ((pendingResult.data ?? []) as QuoteDbRow[]).map(toRow),
    canApprove: decidableTypes.length > 0,
    storageMissing: false,
  };
}

// ── Empresa (opcional) ───────────────────────────────────────────────────────

export interface QuoteAccountOption {
  id: string;
  name: string;
  countryCode: string | null;
}

/** Empresas que la persona puede ver (RLS de su sesión), por nombre. */
export async function searchQuoteAccounts(query: string): Promise<QuoteAccountOption[]> {
  const me = await getCurrentActiveUser();
  const text = query.trim().replace(/[%_,()]/g, ' ').slice(0, 80);
  if (!me || text.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('accounts')
    .select('id, name, country_code')
    .ilike('name', `%${text}%`)
    .order('name')
    .limit(8);
  return ((data ?? []) as Array<{ id: string; name: string; country_code: string | null }>).map((account) => ({
    id: account.id,
    name: account.name,
    countryCode: account.country_code,
  }));
}

// ── Aprobadores (Configuración → Cotizador) ──────────────────────────────────

export interface QuoteApproverSettings {
  byType: Record<QuoteAccountType, { approverIds: string[]; ccIds: string[]; fallbackToAdmins: boolean; approverNames: string[] }>;
  users: PersonRef[];
}

export type QuoteApproverSettingsResult =
  | { ok: true; settings: QuoteApproverSettings }
  | { ok: false; reason: 'forbidden' | 'missing_table' | 'error' };

export async function getQuoteApproverSettings(): Promise<QuoteApproverSettingsResult> {
  if (!(await isCurrentUserAdmin())) return { ok: false, reason: 'forbidden' };
  const admin = createSupabaseAdminClient();
  const [rowsResult, usersResult] = await Promise.all([
    admin.from('sales_quote_approvers').select('account_type, user_id, role'),
    admin.from('internal_users').select('id, full_name, email').eq('access_status', 'active').order('full_name'),
  ]);
  if (rowsResult.error) return { ok: false, reason: rowsResult.error.code === '42P01' ? 'missing_table' : 'error' };
  if (usersResult.error) return { ok: false, reason: 'error' };
  const rows = (rowsResult.data ?? []) as Array<{ account_type: QuoteAccountType; user_id: string; role: 'approver' | 'cc' }>;
  const byType = {} as QuoteApproverSettings['byType'];
  for (const accountType of ACCOUNT_TYPES) {
    const resolved = await resolveQuoteApprovers(admin, accountType);
    byType[accountType] = {
      approverIds: rows.filter((row) => row.account_type === accountType && row.role === 'approver').map((row) => row.user_id),
      ccIds: rows.filter((row) => row.account_type === accountType && row.role === 'cc').map((row) => row.user_id),
      fallbackToAdmins: resolved.fallbackToAdmins,
      approverNames: resolved.approvers.map((person) => person.name),
    };
  }
  return {
    ok: true,
    settings: {
      byType,
      users: ((usersResult.data ?? []) as Array<{ id: string; full_name: string | null; email: string }>).map((user) => ({
        id: user.id,
        name: nameOf(user),
      })),
    },
  };
}

export async function setQuoteApprovers(input: {
  accountType: QuoteAccountType;
  approverIds: string[];
  ccIds: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: 'Solo un admin elige quién aprueba.' };
  if (!ACCOUNT_TYPES.includes(input.accountType)) return { ok: false, error: 'Tipo de cuenta no válido.' };
  const approverIds = [...new Set(input.approverIds.filter(Boolean))];
  const ccIds = [...new Set(input.ccIds.filter((id) => id && !approverIds.includes(id)))];
  const all = [...approverIds, ...ccIds];
  if (all.length > 50) return { ok: false, error: 'Máximo 50 personas por tipo de cuenta.' };

  const admin = createSupabaseAdminClient();
  if (all.length > 0) {
    const { data } = await admin.from('internal_users').select('id').in('id', all).eq('access_status', 'active');
    const found = new Set((data ?? []).map((row) => row.id as string));
    if (all.some((id) => !found.has(id))) return { ok: false, error: 'Alguna persona ya no está activa. Revisa la lista.' };
  }
  const actor = await getCurrentActiveUser();

  const { error: deleteError } = await admin.from('sales_quote_approvers').delete().eq('account_type', input.accountType);
  if (deleteError) {
    return { ok: false, error: deleteError.code === '42P01' ? 'Falta aplicar la migración 170.' : 'No pudimos guardar. Vuelve a probar.' };
  }
  if (all.length > 0) {
    const { error } = await admin.from('sales_quote_approvers').insert([
      ...approverIds.map((id) => ({ account_type: input.accountType, user_id: id, role: 'approver', created_by: actor?.id ?? null })),
      ...ccIds.map((id) => ({ account_type: input.accountType, user_id: id, role: 'cc', created_by: actor?.id ?? null })),
    ]);
    if (error) return { ok: false, error: 'No pudimos guardar la lista. Revísala y vuelve a guardar.' };
  }
  revalidatePath('/settings/quotes');
  revalidatePath(QUOTES_PATH);
  return { ok: true };
}
