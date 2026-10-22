'use server';

/**
 * Agente 1 · «Competidores de una empresa» — «Seguir esta referencia» (migración
 * 156). Sólo guarda o borra el seguimiento de la persona; no busca ni gasta.
 */

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { readCompetitorReference } from './competitor-reference';

const requestSchema = z.object({ batchId: z.string().uuid(), follow: z.boolean() }).strict();

export type FollowReferenceResult = { ok: true; following: boolean; message: string } | { ok: false; message: string };

export async function setCompetitorReferenceFollowAction(request: unknown): Promise<FollowReferenceResult> {
  const { internalUserId } = await requireActiveUser();
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: 'Solicitud inválida.' };
  // El lote con la sesión (RLS): sólo se sigue una referencia que la persona ve.
  const supabase = await createClient();
  const { data: batch } = await supabase
    .from('prospect_batches')
    .select('id, metadata')
    .eq('id', parsed.data.batchId)
    .maybeSingle();
  const reference = batch ? readCompetitorReference((batch as { metadata: unknown }).metadata) : null;
  if (!reference) return { ok: false, message: 'Esta búsqueda no es de competidores.' };
  const { setCompetitorReferenceFollow } = await import(
    '@/server/prospect-batches/competitor-search/competitor-watch.server'
  );
  const saved = await setCompetitorReferenceFollow({
    internalUserId,
    reference,
    sourceBatchId: parsed.data.batchId,
    follow: parsed.data.follow,
  });
  if (!saved) return { ok: false, message: 'No se pudo guardar. Intenta de nuevo.' };
  return {
    ok: true,
    following: parsed.data.follow,
    message: parsed.data.follow
      ? `Sigues a ${reference.name}: te avisaremos los lunes.`
      : `Dejaste de seguir a ${reference.name}.`,
  };
}
