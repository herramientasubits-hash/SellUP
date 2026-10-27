import { NextResponse } from 'next/server';
import {
  resolveBulkSearchAccess,
  runBulkSearchRoundForUser,
} from '@/modules/prospect-batches/bulk-search/bulk-search-service.server';

/**
 * Lanza la SIGUIENTE ronda de una búsqueda masiva: una corrida normal del
 * asistente, si todavía faltan empresas y queda tope para su peor caso. La
 * pide el Process Center mientras SellUp está abierto; dos pestañas no lanzan
 * la misma ronda (lease de la 159).
 *
 * Mismo tiempo que una corrida (`wizard-runs`): el trabajo de antes y después
 * es mínimo, y si la función muere a mitad, la ronda siguiente la reconcilia.
 */
export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await resolveBulkSearchAccess();
  if (!access.ok) return NextResponse.json({ ok: false, message: access.message }, { status: access.status });
  const { id } = await context.params;
  const result = await runBulkSearchRoundForUser(access.userId, id);
  return NextResponse.json(result, { status: result.ok ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
}
