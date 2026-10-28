'use server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { NON_ASSIGNABLE_CANDIDATE_STATUSES } from '@/modules/assignment/assignment-core';
import { resolveBulkSearchAccess } from './bulk-search-service.server';

/**
 * «Asignar a…» desde una búsqueda masiva (GROWTH-BULK-SEARCH-1 · PR 4): las
 * candidatas que sus rondas trajeron y siguen por asignar. La asignación es la de
 * siempre (`assignCandidatesToUser`, con su alcance comercial y sus avisos);
 * aquí sólo se dice CUÁLES.
 */

const IN_CHUNK = 100;

export interface BulkSearchPendingCandidate {
  id: string;
  name: string;
  currentOwnerId: string | null;
}

export type BulkSearchPendingResult =
  | { ok: true; candidates: BulkSearchPendingCandidate[] }
  | { ok: false; message: string };

export async function getBulkSearchPendingCandidatesAction(bulkSearchId: string): Promise<BulkSearchPendingResult> {
  const access = await resolveBulkSearchAccess();
  if (!access.ok) return { ok: false, message: access.message };
  const admin = createSupabaseAdminClient();

  // La búsqueda tiene que ser de quien pregunta.
  const { data: search } = await admin
    .from('prospect_bulk_searches')
    .select('id')
    .eq('id', bulkSearchId)
    .eq('created_by', access.userId)
    .maybeSingle();
  if (!search) return { ok: false, message: 'No encontramos esa búsqueda masiva.' };

  const { data: rounds } = await admin
    .from('prospect_bulk_search_rounds')
    .select('batch_id')
    .eq('bulk_search_id', bulkSearchId);
  const batchIds = [
    ...new Set(((rounds as Array<{ batch_id: string | null }> | null) ?? []).map((r) => r.batch_id).filter(Boolean)),
  ] as string[];

  const candidates: BulkSearchPendingCandidate[] = [];
  for (let i = 0; i < batchIds.length; i += IN_CHUNK) {
    const { data, error } = await admin
      .from('prospect_candidates')
      .select('id, name, assigned_to')
      .in('batch_id', batchIds.slice(i, i + IN_CHUNK))
      // Las mismas que se pueden asignar en «Por revisar»: ni convertidas, ni descartadas, ni duplicadas.
      .not('status', 'in', `(${NON_ASSIGNABLE_CANDIDATE_STATUSES.join(',')})`)
      .order('created_at', { ascending: true });
    if (error) return { ok: false, message: 'No se pudieron leer las empresas de la búsqueda.' };
    for (const row of (data as Array<{ id: string; name: string | null; assigned_to: string | null }> | null) ?? []) {
      candidates.push({ id: row.id, name: row.name ?? 'Empresa', currentOwnerId: row.assigned_to });
    }
  }
  return { ok: true, candidates };
}
