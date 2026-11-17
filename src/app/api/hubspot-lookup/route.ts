import { NextResponse, type NextRequest } from 'next/server';
import { resolveActiveInternalUserId } from '@/server/agents/first-call/request-user.server';
import {
  lookupHubSpotActivity,
  lookupHubSpotCompany,
  lookupHubSpotContact,
  lookupHubSpotContactsForAccount,
  lookupHubSpotProperties,
  lookupHubSpotSearch,
} from '@/modules/hubspot-lookup/lookup.server';

/**
 * Consulta de HubSpot desde SellUp (sólo lectura). Es una ruta y no una acción del
 * servidor a propósito: el navegador manda las acciones de a una y las navegaciones
 * esperan detrás (Prod 19-10). La búsqueda mientras se escribe y la actividad de HubSpot
 * (unos segundos) trababan la pantalla.
 *
 * GET ?op=search&q=…            → empresas y contactos de HubSpot con lo escrito.
 * GET ?op=company&id=<companyId>  → ficha de consulta de la empresa y sus contactos.
 * GET ?op=contact&id=<contactId>  → ficha de consulta del contacto y su empresa.
 * GET ?op=activity&kind=company|contact&id=… → su actividad en HubSpot.
 * GET ?op=properties&kind=company|contact&id=… → todos sus datos en HubSpot, por grupos.
 * GET ?op=account-contacts&accountId=<uuid> → contactos de HubSpot de una empresa de SellUp.
 *
 * Cualquier persona activa puede consultar (decisión de la dueña 17-11).
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const userId = await resolveActiveInternalUserId();
  if (userId === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  if (userId === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });

  const params = request.nextUrl.searchParams;
  const op = params.get('op');
  switch (op) {
    case 'search':
      return NextResponse.json(await lookupHubSpotSearch(params.get('q')), { headers: NO_STORE });
    case 'company':
      return NextResponse.json(await lookupHubSpotCompany(params.get('id')), { headers: NO_STORE });
    case 'contact':
      return NextResponse.json(await lookupHubSpotContact(params.get('id')), { headers: NO_STORE });
    case 'activity':
      return NextResponse.json(await lookupHubSpotActivity(params.get('kind'), params.get('id')), { headers: NO_STORE });
    case 'properties':
      return NextResponse.json(await lookupHubSpotProperties(params.get('kind'), params.get('id')), { headers: NO_STORE });
    case 'account-contacts':
      return NextResponse.json(await lookupHubSpotContactsForAccount(params.get('accountId')), { headers: NO_STORE });
    default:
      return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }
}
