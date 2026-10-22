// Regla de alcance comercial de un lote, compartida por «Enviar a revisión» y por
// «Verificar tamaño» de Competidores (auditoría 21-10). Sin 'use server': no es
// una acción, es un ayudante del servidor.

import { createClient } from '@/lib/supabase/server';
import { resolveCommercialScope } from '@/modules/access/commercial-scope';
import { isCommercialScopeEnabled } from '@/lib/feature-flags.server';

/** Server-side scope guard shared by both branches. Never trusts the client. */
export async function isBatchInScope(batchId: string): Promise<boolean> {
  if (!isCommercialScopeEnabled()) return true;
  const scope = await resolveCommercialScope();
  if (!scope) return false;
  if (scope.canViewAll) return true;

  const supabase = await createClient();
  const { data: batch } = await supabase
    .from('prospect_batches')
    .select('owner_id, created_by')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) return false;

  const allowed = new Set(scope.allowedUserIds);
  const ownerInScope = batch.owner_id != null && allowed.has(batch.owner_id as string);
  const creatorInScope = batch.created_by != null && allowed.has(batch.created_by as string);
  return ownerInScope || creatorInScope;
}

