import { NextResponse, type NextRequest } from 'next/server';
import { resolveActiveInternalUserId } from '@/server/agents/first-call/request-user.server';
import { searchSellUpRecords } from '@/modules/global-search/records.server';

/**
 * Búsqueda general en todo SellUp (sólo lectura): empresas por revisar y descartadas,
 * búsquedas y candidatos de contacto. Es una ruta y no una acción del servidor a propósito:
 * el navegador manda las acciones de a una y la navegación espera detrás (Prod 19-10).
 *
 * GET ?q=… → { hits, failed }. Cada lista aplica su propio alcance comercial.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const userId = await resolveActiveInternalUserId();
  if (userId === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  if (userId === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  return NextResponse.json(await searchSellUpRecords(request.nextUrl.searchParams.get('q'), userId), { headers: NO_STORE });
}
