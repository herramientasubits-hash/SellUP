import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { finishAgentRunForBatch } from '@/modules/prospect-batches/stuck-runs/stuck-runs.server';

/**
 * POST /api/prospect-batches/finish-run — botón «Terminar» (AGENT1-STUCK-RUNS-CLOSE-1).
 *
 * Cierra la continuación abierta de un lote y deja lo encontrado listo para
 * revisar. No llama a ningún proveedor ni gasta créditos.
 *
 * Autorización: la MISMA puerta que la continuación — el lote se lee con el
 * cliente de la PERSONA; si RLS no se lo deja ver, no se cierra nada. Sólo
 * después se usa el cliente de servicio.
 */
export async function POST(request: Request) {
  let batchId: unknown;
  try {
    batchId = ((await request.json()) as { batchId?: unknown }).batchId;
  } catch {
    batchId = null;
  }
  if (typeof batchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(batchId)) {
    return NextResponse.json({ error: 'invalid_batch_id' }, { status: 400 });
  }

  let internalUserId: string;
  try {
    ({ internalUserId } = await requireActiveUser());
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: batch } = await supabase.from('prospect_batches').select('id').eq('id', batchId).maybeSingle();
  if (!batch) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const result = await finishAgentRunForBatch(createSupabaseAdminClient(), batchId, internalUserId);
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[FinishRun] no se pudo terminar la corrida:', error);
    return NextResponse.json({ error: 'finish_failed' }, { status: 500 });
  }
}
