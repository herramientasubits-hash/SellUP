import { NextResponse, after } from 'next/server';
import {
  createBulkSearchForUser,
  listBulkSearchesForUser,
  resolveBulkSearchAccess,
} from '@/modules/prospect-batches/bulk-search/bulk-search-service.server';
import { isBulkSearchServerRunnerEnabled } from '@/modules/prospect-batches/bulk-search/bulk-search-flag.server';
import { kickServerRound } from '@/modules/prospect-batches/bulk-search/bulk-search-server-kick.server';

/**
 * Búsquedas masivas de Growth (GROWTH-BULK-SEARCH-1).
 *
 *   GET  → las de quien está en sesión (Process Center, Growth).
 *   POST → crea una: criterios + «hasta N» + el tope confirmado. El servidor
 *          recalcula el tope y guarda el suyo.
 *
 * Sólo Growth y admin, con ENABLE_GROWTH_BULK_SEARCH encendida.
 */
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  const access = await resolveBulkSearchAccess();
  if (!access.ok) return NextResponse.json({ ok: false, message: access.message }, { status: access.status, headers: NO_STORE });
  const searches = await listBulkSearchesForUser(access.userId);
  return NextResponse.json({ ok: true, searches }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const access = await resolveBulkSearchAccess();
  if (!access.ok) return NextResponse.json({ ok: false, message: access.message }, { status: access.status, headers: NO_STORE });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Petición inválida.' }, { status: 400, headers: NO_STORE });
  }
  const result = await createBulkSearchForUser(access.userId, body);
  // Dueña 28-10: con el conductor del servidor encendido, la primera ronda la pide
  // el servidor y las demás se encadenan solas, aunque se cierre SellUp.
  if (result.ok && isBulkSearchServerRunnerEnabled()) {
    after(() => kickServerRound({ bulkSearchId: result.search.id, consecutiveWaits: 0, delayMs: 0 }));
  }
  const status = result.ok ? 201 : result.code === 'INVALID_REQUEST' ? 400 : 409;
  return NextResponse.json(result, { status, headers: NO_STORE });
}
