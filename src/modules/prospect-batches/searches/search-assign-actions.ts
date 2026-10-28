'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/modules/access/actions';
import { NON_ASSIGNABLE_CANDIDATE_STATUSES } from '@/modules/assignment/assignment-core';
import { isBatchInScope } from '@/modules/prospect-discards/batch-in-scope.server';

/**
 * «Asignar a…» sobre una búsqueda entera (Empresas › Búsquedas): las empresas que
 * la búsqueda trajo y siguen por revisar. La asignación es la de siempre
 * (`assignCandidatesToUser`, con su alcance comercial y sus avisos); aquí sólo se
 * dice CUÁLES. Las ya creadas se reasignan desde Empresas (dueña 28-10).
 */

const PAGE = 1000;

export interface SearchPendingCandidate {
  id: string;
  name: string;
  currentOwnerId: string | null;
}

export type SearchPendingResult =
  | { ok: true; candidates: SearchPendingCandidate[] }
  | { ok: false; message: string };

export async function getSearchPendingCandidatesAction(batchIds: readonly string[]): Promise<SearchPendingResult> {
  const user = await getCurrentUser();
  if (!user || user.access_status !== 'active') {
    return { ok: false, message: 'Tu sesión no está activa. Vuelve a entrar.' };
  }
  const ids = [...new Set(batchIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return { ok: false, message: 'No encontramos esa búsqueda.' };
  // Sólo quien la lanzó o es responsable de ella (él o su equipo) la reparte entera.
  for (const id of ids) {
    if (!(await isBatchInScope(id))) return { ok: false, message: 'Esta búsqueda no es tuya: no la puedes repartir.' };
  }

  const supabase = await createClient();
  const candidates: SearchPendingCandidate[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('prospect_candidates')
      .select('id, name, assigned_to')
      .in('batch_id', ids)
      .not('status', 'in', `(${NON_ASSIGNABLE_CANDIDATE_STATUSES.join(',')})`)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, message: 'No se pudieron leer las empresas de la búsqueda.' };
    const rows = (data as Array<{ id: string; name: string | null; assigned_to: string | null }> | null) ?? [];
    for (const row of rows) candidates.push({ id: row.id, name: row.name ?? 'Empresa', currentOwnerId: row.assigned_to });
    if (rows.length === 0) break;
  }
  return { ok: true, candidates };
}
