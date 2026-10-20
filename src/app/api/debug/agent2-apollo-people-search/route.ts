/**
 * GET /api/debug/agent2-apollo-people-search?domain=davivienda.com
 *
 * AGENT2-APOLLO-PEOPLE-SEARCH-V2-1 — compara, para una empresa ya buscada antes, la búsqueda de
 * personas de Apollo de siempre con la del formato documentado, y dice cuántas personas trae cada
 * intento con una muestra de cargos. Es la prueba para decidir si se enciende
 * ENABLE_APOLLO_PEOPLE_SEARCH_V2.
 *
 * 0 créditos: sólo usa la búsqueda de personas (gratis) y el organization_id que ya guardó una
 * búsqueda anterior de ese dominio; nunca vuelve a buscar la empresa en Apollo. No escribe nada
 * y no devuelve nombres, correos ni teléfonos. Como mucho seis llamadas por consulta.
 *
 * Acceso: admin-only (sesión autenticada + RPC `is_admin`), igual que los demás diagnósticos.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isApolloPeopleSearchV2Enabled, APOLLO_PEOPLE_SEARCH_V2_FLAG } from '@/lib/feature-flags.server';
import {
  loadDiagnosticTargetForDomain,
  runPeopleSearchDiagnostic,
} from '@/server/agents/contact-enrichment-toolkit/apollo-people-search-diagnostic.server';

export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };
const DOMAIN_PATTERN = /^[a-z0-9.-]{3,253}$/;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: NO_STORE });
  }
  const { data: isAdmin } = await supabase.rpc('is_admin', { p_auth_user_id: user.id });
  if (!isAdmin) {
    return NextResponse.json({ error: 'Acceso restringido a administradores' }, { status: 403, headers: NO_STORE });
  }

  const raw = request.nextUrl.searchParams.get('domain')?.trim().toLowerCase() ?? '';
  const domain = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!DOMAIN_PATTERN.test(domain)) {
    return NextResponse.json(
      { error: 'Indica el dominio de la empresa, por ejemplo ?domain=davivienda.com' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const target = await loadDiagnosticTargetForDomain(domain);
    if (!target) {
      return NextResponse.json(
        { error: 'No hay búsquedas de contactos anteriores para ese dominio: busca contactos de la empresa una vez y vuelve a intentarlo.' },
        { status: 404, headers: NO_STORE },
      );
    }
    const report = await runPeopleSearchDiagnostic(target);
    return NextResponse.json(
      {
        config_version: 'agent2_apollo_people_search_diagnostic_v1',
        flag: { name: APOLLO_PEOPLE_SEARCH_V2_FLAG, enabled: isApolloPeopleSearchV2Enabled() },
        ...report,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error('[agent2] apollo people search diagnostic failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'El diagnóstico falló. Vuelve a intentarlo.' }, { status: 500, headers: NO_STORE });
  }
}
