'use server';

// «Buscar contactos de las aprobadas»: las empresas que una búsqueda de
// prospectos ya creó, para abrir con ellas la búsqueda masiva de contactos.

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/modules/access/actions';
import { checkCapability } from '@/modules/access/capabilities.server';
import { isBatchInScope } from '@/modules/prospect-discards/batch-in-scope.server';
import { collectConvertedAccountIds } from './bulk-enrichment-sources-core';
import { CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS } from './bulk-enrichment-types';

export interface BatchConvertedAccount {
  id: string;
  name: string | null;
  domain: string | null;
  country_code: string | null;
}

export type BatchConvertedAccountsResult =
  | { success: true; accounts: BatchConvertedAccount[]; total: number; truncated: boolean; max: number }
  | { success: false; error: string };

/** Lecturas con `.in()` en grupos: los ids viajan en la URL. */
const IN_CHUNK = 50;
const CANDIDATE_PAGE = 1000;

export async function getBatchConvertedAccountsForBulkEnrichmentAction(
  batchId: string,
): Promise<BatchConvertedAccountsResult> {
  try {
    const allowed = await checkCapability('enriquecerMasivo');
    if (!allowed.ok) return { success: false, error: allowed.message };
    const user = await getCurrentUser();
    if (!user || user.access_status !== 'active') {
      return { success: false, error: 'Tu sesión no está activa. Vuelve a entrar.' };
    }
    if (typeof batchId !== 'string' || !batchId || !(await isBatchInScope(batchId))) {
      return { success: false, error: 'No encontramos esa búsqueda.' };
    }

    const supabase = await createClient();
    const rows: Array<{ status: string | null; converted_account_id: string | null }> = [];
    for (let from = 0; ; from += CANDIDATE_PAGE) {
      const { data, error } = await supabase
        .from('prospect_candidates')
        .select('status, converted_account_id')
        .eq('batch_id', batchId)
        .eq('status', 'converted_to_account')
        .not('converted_account_id', 'is', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + CANDIDATE_PAGE - 1);
      if (error) return { success: false, error: 'No se pudieron leer las empresas de la búsqueda.' };
      rows.push(...((data ?? []) as typeof rows));
      if (!data || data.length < CANDIDATE_PAGE) break;
    }

    const ids = collectConvertedAccountIds(rows);
    const accounts: BatchConvertedAccount[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const { data, error } = await supabase
        .from('accounts')
        .select('id, name, domain, country_code')
        .in('id', chunk)
        .is('archived_at', null);
      if (error) return { success: false, error: 'No se pudieron leer las empresas de la búsqueda.' };
      const byId = new Map(((data ?? []) as BatchConvertedAccount[]).map((account) => [account.id, account]));
      for (const id of chunk) {
        const account = byId.get(id);
        if (account) accounts.push(account);
      }
    }

    const max = CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS;
    return {
      success: true,
      accounts: accounts.slice(0, max),
      total: accounts.length,
      truncated: accounts.length > max,
      max,
    };
  } catch (err) {
    console.error('[bulk-enrichment-sources] read failed:', err instanceof Error ? err.message : err);
    return { success: false, error: 'No se pudieron leer las empresas de la búsqueda.' };
  }
}
