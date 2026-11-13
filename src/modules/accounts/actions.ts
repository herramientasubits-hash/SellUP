'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { loadDirectoryNames, loadDirectoryUsers } from '@/modules/access/user-directory.server';
import { isCommercialScopeEnabled } from '@/lib/feature-flags.server';
import { resolveCommercialScope } from '@/modules/access/commercial-scope';
import { resolveScopedUserIds } from '@/modules/access/commercial-scope-logic';
import { revalidatePath } from 'next/cache';
import { requireOwnerForCreate } from '@/lib/ownership/resolve-owner-for-create';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { findExistingAccountForCandidate } from '@/modules/prospect-batches/approval-idempotency';
import { checkHubSpotCompanyCommercialStatus } from '@/server/agents/prospecting-toolkit/hubspot-commercial-checker';
import {
  decideManualAccountHubSpot,
  manualAccountIdentityError,
  MANUAL_ACCOUNT_MESSAGES,
} from './manual-account-checks';
import {
  partitionByCurrentOwner,
  validateAssignmentRequest,
  type AssignmentActionResult,
} from '@/modules/assignment/assignment-core';
import {
  assignmentUserName,
  loadActiveAssignmentUser,
  loadAssignmentActor,
  loadAssignmentTarget,
  listAssignableUsers,
  notifyAssignment,
} from '@/modules/assignment/assignment.server';
import type {
  Account,
  AccountWithOwner,
  AccountAuditEntry,
  AccountListItem,
  AccountsSummary,
  CreateAccountInput,
  UpdateAccountInput,
  InternalUserOption,
  AccountAuditAction,
  PipelineStatus,
} from './types';

// ============================================================
// Auth helpers
// ============================================================

async function requireActiveUser(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');
  return { internalUserId: internalUser.id };
}

// Respeta «Ver como…»: mientras se prueba otro rol, no es administrador.
async function requireAdmin(): Promise<{ internalUserId: string }> {
  const { internalUserId } = await requireActiveUser();
  if (!(await isCurrentUserAdmin().catch(() => false))) {
    throw new Error('Acceso restringido: se requiere rol admin');
  }
  return { internalUserId };
}

// ============================================================
// Commercial scope
// ============================================================

// Columns on `accounts` that attribute a row to an internal user. A non-admin
// sees an account when they (or someone in their scope) either own it or
// created it.
const ACCOUNT_OWNER_COLUMNS = ['owner_id', 'created_by'] as const;

/**
 * Resolve the internal_users.ids whose accounts the current user may see.
 *
 * Returns:
 *  - `null` → apply no constraint (scope flag off, or admin / view-all).
 *  - `[]`   → constraint that matches nothing (e.g. requested a user outside scope).
 *  - `[ids]`→ restrict to accounts owned/created by these ids.
 *
 * Gated behind ENABLE_COMMERCIAL_SCOPE: when the flag is off the result is
 * always `null`, preserving the pre-scope behaviour (all active users see all
 * accounts).
 */
async function resolveAccountScopeIds(
  requestedUserId?: string,
): Promise<string[] | null> {
  if (!isCommercialScopeEnabled()) return null;
  const scope = await resolveCommercialScope();
  if (!scope) return []; // authenticated-but-no-scope → see nothing, never all
  return resolveScopedUserIds(scope, requestedUserId);
}

/** Build a PostgREST `.or()` clause matching any owner column against `ids`. */
function ownerOrClause(ids: string[]): string {
  return ACCOUNT_OWNER_COLUMNS.map((col) => `${col}.in.(${ids.join(',')})`).join(
    ',',
  );
}

// ============================================================
// Utilidades
// ============================================================

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(website: string): string | null {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// ============================================================
// getAccountsSummary
// ============================================================

export async function getAccountsSummary(): Promise<AccountsSummary> {
  await requireActiveUser();
  const supabase = await createClient();

  const scopeIds = await resolveAccountScopeIds();
  // Empty scope → no accounts visible; return a zeroed summary.
  if (scopeIds !== null && scopeIds.length === 0) {
    return { total: 0, new: 0, ready_for_research: 0, ready_for_outreach: 0, archived: 0 };
  }

  let summaryQuery = supabase
    .from('accounts')
    .select('pipeline_status')
    .is('archived_at', null);
  if (scopeIds) summaryQuery = summaryQuery.or(ownerOrClause(scopeIds));

  const { data, error } = await summaryQuery;

  if (error) throw new Error(`getAccountsSummary: ${error.message}`);

  const counts = (data ?? []).reduce(
    (acc, row) => {
      const s = row.pipeline_status as PipelineStatus;
      acc.total += 1;
      if (s === 'new') acc.new += 1;
      if (s === 'ready_for_research') acc.ready_for_research += 1;
      if (s === 'ready_for_outreach') acc.ready_for_outreach += 1;
      return acc;
    },
    { total: 0, new: 0, ready_for_research: 0, ready_for_outreach: 0, archived: 0 },
  );

  let archivedQuery = supabase
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .not('archived_at', 'is', null);
  if (scopeIds) archivedQuery = archivedQuery.or(ownerOrClause(scopeIds));

  const { count: archivedCount } = await archivedQuery;

  counts.archived = archivedCount ?? 0;

  return counts;
}

// ============================================================
// getAccountsList
// ============================================================

export async function getAccountsList(): Promise<AccountListItem[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const scopeIds = await resolveAccountScopeIds();
  if (scopeIds !== null && scopeIds.length === 0) return [];

  let listQuery = supabase
    .from('accounts')
    .select(
      `id, name, country, country_code, industry, website, domain,
       pipeline_status, source, created_at, owner_id`,
    )
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (scopeIds) listQuery = listQuery.or(ownerOrClause(scopeIds));

  const { data, error } = await listQuery;

  if (error) throw new Error(`getAccountsList: ${error.message}`);

  // Nombres por el directorio (cliente de servicio): la RLS de `internal_users`
  // no deja a un no-admin leer el nombre de otra persona. Las filas ya vienen
  // filtradas por alcance.
  const ownerNames = await loadDirectoryNames((data ?? []).map((row) => row.owner_id as string | null));

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    country: row.country,
    country_code: row.country_code,
    industry: row.industry,
    website: row.website,
    domain: row.domain,
    pipeline_status: row.pipeline_status as PipelineStatus,
    source: row.source as Account['source'],
    created_at: row.created_at,
    owner_id: (row.owner_id as string | null) ?? null,
    owner_name: row.owner_id ? ownerNames.get(row.owner_id as string) ?? null : null,
  }));
}

// ============================================================
// getActiveAccountsForPicker
// ============================================================
// Returns only non-archived accounts for use in contact-creation pickers.
// Deduplicates by normalized domain via dedupAccountsForPicker (pure, testable).

export type { AccountPickerOption } from './account-picker-dedup';
import { dedupAccountsForPicker } from './account-picker-dedup';

export async function getActiveAccountsForPicker(): Promise<import('./account-picker-dedup').AccountPickerOption[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const scopeIds = await resolveAccountScopeIds();
  if (scopeIds !== null && scopeIds.length === 0) return [];

  let query = supabase
    .from('accounts')
    .select('id, name, domain, hubspot_company_id')
    .is('archived_at', null)
    .neq('pipeline_status', 'archived')
    .order('name', { ascending: true })
    .limit(500);
  if (scopeIds) query = query.or(ownerOrClause(scopeIds));

  const { data, error } = await query;
  if (error) throw new Error(`getActiveAccountsForPicker: ${error.message}`);

  return dedupAccountsForPicker(
    (data ?? []) as import('./account-picker-dedup').PickerRow[],
  );
}

// ============================================================
// getAccountById
// ============================================================

export async function getAccountById(id: string): Promise<AccountWithOwner | null> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`getAccountById: ${error.message}`);
  }

  // Enforce scope on direct id access: a non-admin must not open an account
  // outside their allowed owner/creator set by guessing its id.
  const scopeIds = await resolveAccountScopeIds();
  if (scopeIds !== null) {
    const allowed = new Set(scopeIds);
    const acct = data as unknown as AccountWithOwner;
    const ownerInScope = acct.owner_id != null && allowed.has(acct.owner_id);
    const creatorInScope = acct.created_by != null && allowed.has(acct.created_by);
    if (!ownerInScope && !creatorInScope) return null;
  }

  // Responsable y creador por el directorio, DESPUÉS del alcance (la RLS no deja
  // a un no-admin leer a otra persona). Misma forma que el embed de antes.
  const acct = data as unknown as Account;
  const people = await loadDirectoryUsers([acct.owner_id, acct.created_by]);
  const owner = acct.owner_id ? people.get(acct.owner_id) : undefined;
  const creator = acct.created_by ? people.get(acct.created_by) : undefined;
  return {
    ...acct,
    owner: owner ? { id: owner.id, full_name: owner.fullName, email: owner.email ?? '' } : null,
    created_by_user: creator ? { id: creator.id, full_name: creator.fullName } : null,
  };
}

// ============================================================
// getAccountAudit
// ============================================================

export async function getAccountAudit(accountId: string): Promise<AccountAuditEntry[]> {
  await requireActiveUser();
  // Callable from the client with any id: the account's own scope check gates it.
  if (!(await getAccountById(accountId))) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('account_audit')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`getAccountAudit: ${error.message}`);

  const rows = (data ?? []) as unknown as AccountAuditEntry[];
  const actors = await loadDirectoryUsers(rows.map((row) => row.actor_user_id));
  return rows.map((row) => {
    const actor = row.actor_user_id ? actors.get(row.actor_user_id) : undefined;
    return { ...row, actor: actor ? { full_name: actor.fullName, email: actor.email ?? '' } : null };
  });
}

// ============================================================
// createAccount
// ============================================================

/**
 * Un responsable elegido que no es quien crea pasa por la misma regla que
 * «Asignar a…» (vendedor: sólo a sí mismo; activo). `null` si vale.
 */
async function checkChosenOwner(chosenOwnerId: string | null | undefined, actorUserId: string): Promise<string | null> {
  if (!chosenOwnerId || chosenOwnerId === actorUserId) return null;
  const actor = await loadAssignmentActor();
  if (!actor) return 'Tu sesión no está activa. Vuelve a entrar.';
  const check = await loadAssignmentTarget(actor, chosenOwnerId);
  return check.ok ? null : check.error;
}

export async function createAccount(
  input: CreateAccountInput,
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const name = input.name.trim();
  if (!name) return { success: false, error: 'El nombre es requerido' };

  const ownerError = await checkChosenOwner(input.owner_id, internalUserId);
  if (ownerError) return { success: false, error: ownerError };

  const domain = input.website ? extractDomain(input.website) : null;
  const normalizedName = normalizeText(name);

  const payload = {
    name,
    legal_name: input.legal_name?.trim() || null,
    normalized_name: normalizedName,
    website: input.website?.trim() || null,
    domain,
    country: input.country?.trim() || null,
    country_code: input.country_code?.trim() || null,
    city: input.city?.trim() || null,
    region: input.region?.trim() || null,
    industry: input.industry || null,
    company_size: input.company_size || null,
    tax_identifier: input.tax_identifier?.trim() || null,
    tax_identifier_type: input.tax_identifier_type || null,
    // ALWAYS-OWNER-ON-CREATE-1 — sin responsable elegido, el responsable es quien la crea.
    owner_id: requireOwnerForCreate(
      { chosenOwnerId: input.owner_id, actorUserId: internalUserId },
      'la empresa',
    ),
    notes: input.notes?.trim() || null,
    source: 'manual' as const,
    pipeline_status: 'new' as const,
    created_by: internalUserId,
    updated_by: internalUserId,
  };

  const { data, error } = await supabase
    .from('accounts')
    .insert(payload)
    .select('id')
    .single();

  if (error) return { success: false, error: error.message };

  await logAccountAudit({
    accountId: data.id,
    actorUserId: internalUserId,
    actionType: 'account_created',
    details: { name, source: 'manual' },
  });

  return { success: true, id: data.id };
}

// ============================================================
// addAccountManually — «Agregar empresa» con revisión de duplicados
// ============================================================

/**
 * Lo que usa el drawer «Agregar empresa». Antes de crear: exige sitio web o NIT, busca la
 * empresa en SellUp (NIT + país o dominio, la misma búsqueda de la aprobación de
 * prospectos, sobre TODAS las cuentas, no sólo las que el usuario ve) y en HubSpot. Lo que
 * ya existe no se duplica: se ofrece abrirla o se vincula a la empresa de HubSpot.
 */
export async function addAccountManually(
  input: CreateAccountInput,
): Promise<
  | { success: true; id: string; notice: string | null }
  | { success: false; error: string; existingAccountId?: string }
> {
  const { internalUserId } = await requireActiveUser();

  const name = input.name.trim();
  if (!name) return { success: false, error: 'El nombre es requerido' };
  const ownerError = await checkChosenOwner(input.owner_id, internalUserId);
  if (ownerError) return { success: false, error: ownerError };
  const domain = input.website ? extractDomain(input.website) : null;
  const taxIdentifier = input.tax_identifier?.trim() || null;
  const countryCode = input.country_code?.trim() || null;

  const identityError = manualAccountIdentityError({ domain, taxIdentifier });
  if (identityError) return { success: false, error: identityError };

  const existing = await findExistingAccountForCandidate(createSupabaseAdminClient(), {
    tax_identifier: taxIdentifier,
    country_code: countryCode,
    domain,
  });
  if (existing) {
    // Sólo se ofrece abrirla si quien agrega puede verla.
    const visible = await getAccountById(existing.accountId);
    return visible
      ? {
          success: false,
          error: MANUAL_ACCOUNT_MESSAGES.existsVisible(visible.name),
          existingAccountId: visible.id,
        }
      : { success: false, error: MANUAL_ACCOUNT_MESSAGES.existsOtherSeller };
  }

  let hubspot: ReturnType<typeof decideManualAccountHubSpot>;
  try {
    hubspot = decideManualAccountHubSpot(
      await checkHubSpotCompanyCommercialStatus({ name, domain, taxId: taxIdentifier, countryCode }),
    );
  } catch (err) {
    console.error('[addAccountManually] HubSpot check failed:', err instanceof Error ? err.message : err);
    hubspot = { kind: 'create', notice: MANUAL_ACCOUNT_MESSAGES.hubspotUnavailable };
  }
  if (hubspot.kind === 'block') return { success: false, error: hubspot.error };

  const created = await createAccount(input);
  if (!created.success) return created;

  if (hubspot.kind === 'link') {
    const supabase = await createClient();
    const { error } = await supabase
      .from('accounts')
      .update({ hubspot_company_id: hubspot.hubspotCompanyId })
      .eq('id', created.id);
    if (error) {
      console.error('[addAccountManually] link HubSpot failed:', error.message);
      return { success: true, id: created.id, notice: MANUAL_ACCOUNT_MESSAGES.hubspotPossible };
    }
  }
  return { success: true, id: created.id, notice: hubspot.notice };
}

// ============================================================
// updateAccount
// ============================================================

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const current = await getAccountById(id);
  if (!current) return { success: false, error: 'Cuenta no encontrada' };

  const payload: Partial<Account> & { updated_by: string } = {
    updated_by: internalUserId,
  };

  if (input.name !== undefined) {
    payload.name = input.name.trim();
    payload.normalized_name = normalizeText(input.name);
  }
  if (input.legal_name !== undefined) payload.legal_name = input.legal_name.trim() || null;
  if (input.website !== undefined) {
    payload.website = input.website.trim() || null;
    payload.domain = input.website ? extractDomain(input.website) : null;
  }
  if (input.country !== undefined) payload.country = input.country.trim() || null;
  if (input.country_code !== undefined) payload.country_code = input.country_code.trim() || null;
  if (input.city !== undefined) payload.city = input.city.trim() || null;
  if (input.region !== undefined) payload.region = input.region.trim() || null;
  if (input.industry !== undefined) payload.industry = input.industry || null;
  if (input.company_size !== undefined) payload.company_size = input.company_size || null;
  if (input.tax_identifier !== undefined) payload.tax_identifier = input.tax_identifier.trim() || null;
  if (input.tax_identifier_type !== undefined) payload.tax_identifier_type = input.tax_identifier_type || null;
  if (input.notes !== undefined) payload.notes = input.notes.trim() || null;
  if (input.metadata !== undefined) payload.metadata = input.metadata;

  const ownerChanged = input.owner_id !== undefined && input.owner_id !== current.owner_id;
  // Dejar una empresa sin responsable sólo lo hace un admin: sin dueño nadie del
  // equipo la ve (y en HubSpot queda huérfana).
  if (ownerChanged && !input.owner_id && !(await isCurrentUserAdmin().catch(() => false))) {
    return { success: false, error: 'Elige un responsable: la empresa no puede quedar sin dueño.' };
  }
  if (ownerChanged && input.owner_id) {
    const assigner = await loadAssignmentActor();
    const check = assigner ? await loadAssignmentTarget(assigner, input.owner_id) : null;
    if (!check?.ok) return { success: false, error: check?.error ?? 'Tu sesión no está activa. Vuelve a entrar.' };
  }
  const statusChanged =
    input.pipeline_status !== undefined && input.pipeline_status !== current.pipeline_status;

  if (input.owner_id !== undefined) payload.owner_id = input.owner_id || null;
  if (input.pipeline_status !== undefined) payload.pipeline_status = input.pipeline_status;
  if (input.pipeline_substatus !== undefined) payload.pipeline_substatus = input.pipeline_substatus;

  const { error } = await supabase.from('accounts').update(payload).eq('id', id);
  if (error) return { success: false, error: error.message };

  if (statusChanged) {
    await logAccountAudit({
      accountId: id,
      actorUserId: internalUserId,
      actionType: 'account_status_changed',
      details: { from: current.pipeline_status, to: input.pipeline_status },
    });
  } else if (ownerChanged) {
    await logAccountAudit({
      accountId: id,
      actorUserId: internalUserId,
      actionType: 'account_owner_changed',
      details: { from: current.owner_id, to: input.owner_id },
    });
  } else {
    await logAccountAudit({
      accountId: id,
      actorUserId: internalUserId,
      actionType: 'account_updated',
      details: {},
    });
  }

  return { success: true };
}

// ============================================================
// archiveAccount
// ============================================================

export async function archiveAccount(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  let internalUserId: string;
  try {
    ({ internalUserId } = await requireAdmin());
  } catch {
    return { success: false, error: 'Se requiere rol admin para archivar cuentas' };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('accounts')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: internalUserId,
      pipeline_status: 'archived',
      updated_by: internalUserId,
    })
    .eq('id', id)
    .is('archived_at', null);

  if (error) return { success: false, error: error.message };

  await logAccountAudit({
    accountId: id,
    actorUserId: internalUserId,
    actionType: 'account_archived',
    details: {},
  });

  return { success: true };
}

/** Tope de una selección en lote: la tabla nunca muestra más de 200 empresas. */
const ARCHIVE_ACCOUNTS_MAX = 200;

/**
 * Archiva varias empresas de una vez (barra de selección de la tabla). Mismas reglas
 * que `archiveAccount`: sólo admin, salen del pipeline activo y cada una queda en
 * auditoría. Las que ya estaban archivadas no cuentan.
 */
export async function archiveAccounts(
  ids: string[],
): Promise<{ success: true; archived: number } | { success: false; error: string }> {
  let internalUserId: string;
  try {
    ({ internalUserId } = await requireAdmin());
  } catch {
    return { success: false, error: 'Se requiere rol admin para archivar cuentas' };
  }

  const uniqueIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  if (uniqueIds.length === 0) return { success: false, error: 'No hay empresas seleccionadas' };
  if (uniqueIds.length > ARCHIVE_ACCOUNTS_MAX) {
    return { success: false, error: `Puedes archivar hasta ${ARCHIVE_ACCOUNTS_MAX} empresas a la vez` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('accounts')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: internalUserId,
      pipeline_status: 'archived',
      updated_by: internalUserId,
    })
    .in('id', uniqueIds)
    .is('archived_at', null)
    .select('id');

  if (error) return { success: false, error: error.message };

  const archivedIds = (data ?? []).map((row) => row.id as string);
  await Promise.all(
    archivedIds.map((accountId) =>
      logAccountAudit({
        accountId,
        actorUserId: internalUserId,
        actionType: 'account_archived',
        details: { bulk: true, selection_size: uniqueIds.length },
      }),
    ),
  );

  return { success: true, archived: archivedIds.length };
}

// ============================================================
// assignAccountsToUser — «Asignar a…» (BULK-COMPANY-ASSIGNMENT-1)
// ============================================================

/**
 * Cambia el responsable de una o varias empresas. Dueña 12-11: admin, manager,
 * líder y Growth asignan a cualquier usuario activo; el vendedor, sólo a sí
 * mismo (`loadAssignmentTarget`). Con el alcance comercial encendido, solo se
 * asigna lo que quien asigna puede ver (en cascada).
 * Cada empresa que cambia queda en auditoría y quien recibe tiene un aviso en la
 * campanita. No escribe en HubSpot.
 */
export async function assignAccountsToUser(
  accountIds: string[],
  targetUserId: string,
): Promise<AssignmentActionResult> {
  const { internalUserId } = await requireActiveUser();

  const request = validateAssignmentRequest({ ids: accountIds, targetUserId });
  if (!request.ok) return { success: false, error: request.error };

  const supabase = await createClient();
  const assigner = await loadAssignmentActor();
  if (!assigner || assigner.id !== internalUserId) return { success: false, error: 'Tu sesión no está activa. Vuelve a entrar.' };
  const [targetResult, actor] = await Promise.all([
    loadAssignmentTarget(assigner, request.targetUserId),
    loadActiveAssignmentUser(createSupabaseAdminClient(), internalUserId),
  ]);
  if (!targetResult.ok) return { success: false, error: targetResult.error };
  const target = targetResult.user;

  const { data: rows, error: loadError } = await supabase
    .from('accounts')
    .select('id, name, owner_id, created_by')
    .in('id', request.ids)
    .is('archived_at', null);
  if (loadError) return { success: false, error: loadError.message };

  const scopeIds = await resolveAccountScopeIds();
  const allowed = scopeIds === null ? null : new Set(scopeIds);
  const visible = (rows ?? []).filter(
    (row) =>
      allowed === null ||
      (row.owner_id != null && allowed.has(row.owner_id as string)) ||
      (row.created_by != null && allowed.has(row.created_by as string)),
  );

  const { toChange, alreadyOwned } = partitionByCurrentOwner(
    visible.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      currentOwnerId: (row.owner_id as string | null) ?? null,
    })),
    target.id,
  );

  let changed: typeof toChange = [];
  if (toChange.length > 0) {
    const { data: updated, error: updateError } = await supabase
      .from('accounts')
      .update({ owner_id: target.id, updated_by: internalUserId })
      .in('id', toChange.map((row) => row.id))
      .is('archived_at', null)
      .select('id');
    if (updateError) return { success: false, error: updateError.message };

    const updatedIds = new Set((updated ?? []).map((row) => row.id as string));
    changed = toChange.filter((row) => updatedIds.has(row.id));

    if (changed.length > 0) {
      const { error: auditError } = await supabase.from('account_audit').insert(
        changed.map((row) => ({
          account_id: row.id,
          actor_user_id: internalUserId,
          action_type: 'account_owner_changed' as const,
          details: {
            from: row.currentOwnerId,
            to: target.id,
            via: 'assign_action',
            selection_size: request.ids.length,
          },
        })),
      );
      if (auditError) {
        console.error('[assignAccountsToUser] audit insert failed:', auditError.message);
      }
    }
  }

  await notifyAssignment({
    kind: 'accounts',
    actor,
    target,
    count: changed.length,
    sampleNames: changed.map((row) => row.name),
  });

  revalidatePath('/accounts');

  return {
    success: true,
    assigned: changed.length,
    alreadyOwned: alreadyOwned.length,
    skipped: request.ids.length - changed.length - alreadyOwned.length,
    targetName: assignmentUserName(target),
  };
}

// ============================================================
// logAccountAudit — interno
// ============================================================

// Sin `export`: en un archivo 'use server' sería una acción con un actor cualquiera.
async function logAccountAudit({
  accountId,
  actorUserId,
  actionType,
  details,
}: {
  accountId: string;
  actorUserId: string | null;
  actionType: AccountAuditAction;
  details: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();
  await supabase.from('account_audit').insert({
    account_id: accountId,
    actor_user_id: actorUserId,
    action_type: actionType,
    details,
  });
}

// ============================================================
// getActiveUsers — para selector de owner
// ============================================================

/**
 * Personas elegibles como responsable o en «Asignar a…», según el rol de quien
 * pide (dueña 12-11): admin, manager, líder y Growth ven a todos los usuarios
 * activos; el vendedor, sólo a sí mismo.
 */
export async function getActiveUsers(): Promise<InternalUserOption[]> {
  await requireActiveUser();
  return (await listAssignableUsers()) as InternalUserOption[];
}
