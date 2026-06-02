'use server';

/**
 * cleanupQaProspectingDataAction
 *
 * Limpieza segura de datos de prueba generados durante los hitos 16AK
 * (Colombia/RUES, socrata_colombia, agent_1, jun 2026).
 *
 * - mode='preview'  → sin escrituras, devuelve conteos y IDs.
 * - mode='execute'  → DELETE físico controlado en SellUp. NO toca HubSpot.
 *
 * Requiere usuario admin (is_admin RPC).
 * Bloquea si hay accounts con hubspot_company_id sin confirmación explícita.
 * NO toca Chile. NO toca México. NO llama HubSpot.
 */

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// ── Tipos públicos ────────────────────────────────────────────

export interface CleanupQaInput {
  mode: 'preview' | 'execute';
  dateFrom: string;            // ISO, inclusive  — ej: '2026-06-01T00:00:00Z'
  dateTo: string;              // ISO, exclusivo  — ej: '2026-06-03T00:00:00Z'
  countryCode: string;         // Debe ser 'CO' para este hito
  /** Si hay accounts con hubspot_company_id, se requiere true para ejecutar. */
  confirmHubspotAccountsExist?: boolean;
}

export interface CleanupQaAccountRow {
  id: string;
  name: string;
  source: string;
  pipeline_status: string;
  hubspot_company_id: string | null;
  created_at: string;
}

export interface CleanupQaBatchRow {
  id: string;
  name: string;
  source: string;
  status: string;
  created_at: string;
}

export interface CleanupQaResult {
  success: boolean;
  mode: 'preview' | 'execute';
  error?: string;
  preview?: {
    batches: CleanupQaBatchRow[];
    batchCount: number;
    candidateCount: number;
    auditCount: number;
    accounts: CleanupQaAccountRow[];
    accountCount: number;
    accountsWithHubspot: CleanupQaAccountRow[];
    hubspotWarning: string | null;
  };
  executed?: {
    deletedAccounts: number;
    deletedBatches: number;
    /** Cascadea automáticamente desde prospect_batches */
    deletedCandidatesCascade: true;
    /** Cascadea automáticamente desde prospect_batches */
    deletedAuditCascade: true;
    /** Cascadea automáticamente desde accounts */
    deletedAccountAuditCascade: true;
    hubspotNotice: string;
  };
}

// ── Implementación ────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function buildAdminClient() {
  return createAdminClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado.' };

  const { data: isAdmin } = await supabase.rpc('is_admin', { p_auth_user_id: user.id });
  if (!isAdmin) return { ok: false, error: 'Se requiere rol admin.' };

  return { ok: true };
}

async function resolveQaBatchIds(
  admin: ReturnType<typeof buildAdminClient>,
  dateFrom: string,
  dateTo: string,
  countryCode: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('prospect_batches')
    .select('id')
    .gte('created_at', dateFrom)
    .lt('created_at', dateTo)
    .eq('country_code', countryCode);

  if (error) throw new Error(`Error al obtener batches: ${error.message}`);
  return (data ?? []).map(r => r.id as string);
}

async function resolveQaBatchDetails(
  admin: ReturnType<typeof buildAdminClient>,
  batchIds: string[],
): Promise<CleanupQaBatchRow[]> {
  if (batchIds.length === 0) return [];
  const { data, error } = await admin
    .from('prospect_batches')
    .select('id, name, source, status, created_at')
    .in('id', batchIds)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Error al obtener detalle batches: ${error.message}`);
  return (data ?? []) as CleanupQaBatchRow[];
}

async function resolveQaCandidateCount(
  admin: ReturnType<typeof buildAdminClient>,
  batchIds: string[],
  dateFrom: string,
  dateTo: string,
  countryCode: string,
): Promise<number> {
  if (batchIds.length === 0) {
    // También contar por source+fecha directamente
    const { count } = await admin
      .from('prospect_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('source_primary', 'socrata_colombia')
      .eq('country_code', countryCode)
      .gte('created_at', dateFrom)
      .lt('created_at', dateTo);
    return count ?? 0;
  }

  const { count } = await admin
    .from('prospect_candidates')
    .select('id', { count: 'exact', head: true })
    .in('batch_id', batchIds);
  return count ?? 0;
}

async function resolveQaAuditCount(
  admin: ReturnType<typeof buildAdminClient>,
  batchIds: string[],
): Promise<number> {
  if (batchIds.length === 0) return 0;
  const { count } = await admin
    .from('prospect_candidate_audit')
    .select('id', { count: 'exact', head: true })
    .in('batch_id', batchIds);
  return count ?? 0;
}

async function resolveQaAccounts(
  admin: ReturnType<typeof buildAdminClient>,
  batchIds: string[],
  dateFrom: string,
  dateTo: string,
  countryCode: string,
): Promise<CleanupQaAccountRow[]> {
  const KNOWN_QA_NAMES = [
    'PRONALTE LIMITADA',
    'PROYECTOS Y CONSTRUCCIONES PROYCON S.A.S.',
    'CORPORACION DE TELEVIDENTES DE LETICIA EN LIQUIDACION',
    'M Y M ASESORES INMOBILIARIOS SAS - EN LIQUIDACION',
    'MOLA DIGITAL SAS - EN LIQUIDACION',
    'ESCANHER ABOGADOS SAS',
  ];

  const mergedMap = new Map<string, CleanupQaAccountRow>();

  const addRows = (rows: CleanupQaAccountRow[]) => {
    for (const r of rows) mergedMap.set(r.id, r);
  };

  // Por converted_account_id de candidatos
  if (batchIds.length > 0) {
    const { data: candidates } = await admin
      .from('prospect_candidates')
      .select('converted_account_id')
      .in('batch_id', batchIds)
      .not('converted_account_id', 'is', null);

    const convertedIds = (candidates ?? [])
      .map(c => c.converted_account_id as string)
      .filter(Boolean);

    if (convertedIds.length > 0) {
      const { data } = await admin
        .from('accounts')
        .select('id, name, source, pipeline_status, hubspot_company_id, created_at')
        .in('id', convertedIds);
      addRows((data ?? []) as CleanupQaAccountRow[]);
    }
  }

  // Por nombres conocidos de QA
  const { data: byName } = await admin
    .from('accounts')
    .select('id, name, source, pipeline_status, hubspot_company_id, created_at')
    .in('name', KNOWN_QA_NAMES);
  addRows((byName ?? []) as CleanupQaAccountRow[]);

  // Por fecha + país + source relevant
  const { data: byDate } = await admin
    .from('accounts')
    .select('id, name, source, pipeline_status, hubspot_company_id, created_at')
    .eq('country_code', countryCode)
    .gte('created_at', dateFrom)
    .lt('created_at', dateTo);
  addRows((byDate ?? []) as CleanupQaAccountRow[]);

  return Array.from(mergedMap.values());
}

export async function cleanupQaProspectingDataAction(
  input: CleanupQaInput,
): Promise<CleanupQaResult> {
  // ── Validar admin ──────────────────────────────────────────
  const authResult = await requireAdmin();
  if (!authResult.ok) {
    return { success: false, mode: input.mode, error: authResult.error };
  }

  // ── Validar parámetros ─────────────────────────────────────
  if (!input.dateFrom || !input.dateTo) {
    return { success: false, mode: input.mode, error: 'dateFrom y dateTo son requeridos.' };
  }
  if (input.countryCode === 'CL' || input.countryCode === 'MX') {
    return {
      success: false,
      mode: input.mode,
      error: 'BLOQUEADO: No se permite cleanup para Chile (CL) o México (MX).',
    };
  }

  const admin = buildAdminClient();

  // ── Resolver datos QA ─────────────────────────────────────
  let batchIds: string[];
  let batchDetails: CleanupQaBatchRow[];
  let candidateCount: number;
  let auditCount: number;
  let accounts: CleanupQaAccountRow[];

  try {
    batchIds      = await resolveQaBatchIds(admin, input.dateFrom, input.dateTo, input.countryCode);
    batchDetails  = await resolveQaBatchDetails(admin, batchIds);
    candidateCount = await resolveQaCandidateCount(admin, batchIds, input.dateFrom, input.dateTo, input.countryCode);
    auditCount    = await resolveQaAuditCount(admin, batchIds);
    accounts      = await resolveQaAccounts(admin, batchIds, input.dateFrom, input.dateTo, input.countryCode);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, mode: input.mode, error: `Error en diagnóstico: ${msg}` };
  }

  const accountsWithHubspot = accounts.filter(a => a.hubspot_company_id !== null);
  const hubspotWarning =
    accountsWithHubspot.length > 0
      ? `⚠️  ${accountsWithHubspot.length} account(s) con hubspot_company_id: ${accountsWithHubspot.map(a => `"${a.name}" (hs_id=${a.hubspot_company_id})`).join(', ')}. Este cleanup NO toca HubSpot. Limpiar HubSpot manualmente si es necesario.`
      : null;

  // ── Modo preview ──────────────────────────────────────────
  if (input.mode === 'preview') {
    return {
      success: true,
      mode: 'preview',
      preview: {
        batches: batchDetails,
        batchCount: batchIds.length,
        candidateCount,
        auditCount,
        accounts,
        accountCount: accounts.length,
        accountsWithHubspot,
        hubspotWarning,
      },
    };
  }

  // ── Modo execute ──────────────────────────────────────────

  // Bloquear si hay accounts con hubspot_company_id sin confirmación
  if (accountsWithHubspot.length > 0 && !input.confirmHubspotAccountsExist) {
    return {
      success: false,
      mode: 'execute',
      error:
        `BLOQUEADO: Existen ${accountsWithHubspot.length} account(s) con hubspot_company_id. ` +
        `Pasa confirmHubspotAccountsExist: true para confirmar que entiendes que este cleanup ` +
        `NO elimina las companies en HubSpot, solo las elimina de SellUp.`,
      preview: {
        batches: batchDetails,
        batchCount: batchIds.length,
        candidateCount,
        auditCount,
        accounts,
        accountCount: accounts.length,
        accountsWithHubspot,
        hubspotWarning,
      },
    };
  }

  if (batchIds.length === 0 && accounts.length === 0) {
    return {
      success: true,
      mode: 'execute',
      executed: {
        deletedAccounts: 0,
        deletedBatches: 0,
        deletedCandidatesCascade: true,
        deletedAuditCascade: true,
        deletedAccountAuditCascade: true,
        hubspotNotice: 'Sin datos QA para eliminar.',
      },
    };
  }

  // ── DELETE físico respetando FK orden ────────────────────
  // Orden seguro:
  //   1. accounts (cascadea → account_audit, SET NULL en prospect_candidates.converted_account_id)
  //   2. prospect_batches (cascadea → prospect_candidates → prospect_candidate_audit)

  let deletedAccounts = 0;
  let deletedBatches  = 0;

  // 1. Eliminar accounts QA
  const accountIds = accounts.map(a => a.id);
  if (accountIds.length > 0) {
    const { error: delAccErr, count } = await admin
      .from('accounts')
      .delete({ count: 'exact' })
      .in('id', accountIds);

    if (delAccErr) {
      return {
        success: false,
        mode: 'execute',
        error: `Error al eliminar accounts: ${delAccErr.message}`,
      };
    }
    deletedAccounts = count ?? accountIds.length;
  }

  // 2. Eliminar prospect_batches QA (cascade → candidates + audit)
  if (batchIds.length > 0) {
    const { error: delBatchErr, count } = await admin
      .from('prospect_batches')
      .delete({ count: 'exact' })
      .in('id', batchIds);

    if (delBatchErr) {
      return {
        success: false,
        mode: 'execute',
        error: `Error al eliminar batches (accounts ya eliminadas): ${delBatchErr.message}`,
      };
    }
    deletedBatches = count ?? batchIds.length;
  }

  return {
    success: true,
    mode: 'execute',
    executed: {
      deletedAccounts,
      deletedBatches,
      deletedCandidatesCascade: true,
      deletedAuditCascade: true,
      deletedAccountAuditCascade: true,
      hubspotNotice:
        accountsWithHubspot.length > 0
          ? `⚠️  ${accountsWithHubspot.length} account(s) eliminadas de SellUp pero NO de HubSpot (hubspot_ids: ${accountsWithHubspot.map(a => a.hubspot_company_id).join(', ')}). Limpiar HubSpot manualmente.`
          : 'Sin accounts con hubspot_company_id — HubSpot no fue afectado.',
    },
  };
}
