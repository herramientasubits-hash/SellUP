import { NextResponse, type NextRequest } from 'next/server';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isAgent1SupplierSearchEnabled } from '@/lib/feature-flags.server';
import { suggestSupplierReferences } from '@/server/prospect-batches/supplier-search/reference-suggestions';
import { buildLiveSupplierReferenceSuggestDeps } from '@/server/prospect-batches/supplier-search/reference-suggestions.server';

/**
 * GET /api/prospect-batches/supplier-reference-suggestions?q=… — entidades públicas
 * sugeridas mientras se escribe la referencia de «Proveedores de una empresa»
 * (AGENT1-SUPPLIER-REFERENCE-SUGGEST-1).
 *
 * Es una ruta y no una acción del servidor a propósito: se pide en cada pausa al
 * escribir, y el navegador manda las acciones del servidor de a una (Prod 19-10).
 * Sólo lectura de datos públicos (compras públicas), con sesión activa y la bandera
 * de «Proveedores». No llama a ningún proveedor ni gasta créditos.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? '';
  if (query.length > 200) return NextResponse.json({ error: 'invalid_query' }, { status: 400, headers: NO_STORE });

  try {
    await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  if (!isAgent1SupplierSearchEnabled()) {
    return NextResponse.json({ suggestions: [] }, { headers: NO_STORE });
  }

  try {
    const suggestions = await suggestSupplierReferences(
      query,
      buildLiveSupplierReferenceSuggestDeps(createSupabaseAdminClient()),
    );
    return NextResponse.json({ suggestions }, { headers: NO_STORE });
  } catch (err) {
    console.error('[supplier-reference-suggest] failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500, headers: NO_STORE });
  }
}
