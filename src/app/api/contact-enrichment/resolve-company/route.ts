import { NextResponse, type NextRequest } from 'next/server';
import { parseAgent2AInput } from '@/modules/contact-enrichment/agent2a-input';
import { activeInternalUserIdForRoute } from '@/modules/contact-enrichment/route-auth.server';
import { resolveCompanyForContactEnrichment } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';

/**
 * Agente 2 · identificar la empresa (SellUp y HubSpot) antes de buscar contactos.
 *
 * Por ruta y no como acción del servidor (AGENT2-RESOLVE-COMPANY-ROUTE-1, 20-10): las
 * acciones de una pestaña van en fila junto con las recargas de pantalla, y una búsqueda se
 * quedó 198 s en «Buscando en SellUp y HubSpot…» esperando detrás de otra cosa. Sólo lee:
 * no crea nada, no llama a Apollo ni a Lusha y no escribe en HubSpot.
 */
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const internalUserId = await activeInternalUserIdForRoute();
  if (!internalUserId) {
    return NextResponse.json({ success: false, error: 'Tu sesión se cerró. Vuelve a iniciar sesión.' }, { status: 401, headers: NO_STORE });
  }
  try {
    const input = parseAgent2AInput(await request.json().catch(() => null));
    const data = await resolveCompanyForContactEnrichment(input);
    return NextResponse.json({ success: true, data }, { headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error buscando empresa';
    return NextResponse.json({ success: false, error: message }, { status: 400, headers: NO_STORE });
  }
}
