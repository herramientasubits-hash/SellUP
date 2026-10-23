import { NextResponse, type NextRequest } from 'next/server';
import { runAutomaticContactEnrichmentForRequestCore } from '@/modules/contact-enrichment/automatic-routing-action-core';
import { activeInternalUserIdForRoute } from '@/modules/contact-enrichment/route-auth.server';
import { canSeeContactEnrichmentRequest } from '@/modules/contact-enrichment/candidate-scope.server';
import { createClient } from '@/lib/supabase/server';

/**
 * Agente 2 · buscar los contactos de una empresa con Rumbo (dueña 20-10).
 *
 * POST: corre el mismo enrutador automático (Apollo y, si no alcanza, Lusha) que antes
 * llamaba el asistente como acción del servidor. Por ruta para que varias búsquedas
 * puedan ir a la vez y el panel se pueda cerrar sin cortarla. Los candidatos quedan
 * siempre «por revisar»: no crea contactos ni escribe en HubSpot.
 */
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const internalUserId = await activeInternalUserIdForRoute();
  if (!internalUserId) {
    return NextResponse.json({ ok: false, code: 'unauthorized', message: 'Inicia sesión.' }, { status: 401, headers: NO_STORE });
  }
  const { id } = await params;
  try {
    // Alcance comercial: sólo se lanza una solicitud propia (o del equipo, o admin). Una ajena
    // responde como inexistente y no gasta créditos.
    if (!(await canSeeContactEnrichmentRequest(await createClient(), id))) {
      return NextResponse.json(
        { ok: false, code: 'not_found', message: 'No encontramos esa búsqueda.' },
        { status: 404, headers: NO_STORE },
      );
    }
    const result = await runAutomaticContactEnrichmentForRequestCore(id, internalUserId, new Date().toISOString());
    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (err) {
    console.error('[agent2] contact search failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, code: 'unexpected_error', message: 'Algo falló al buscar contactos. Vuelve a intentarlo.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
