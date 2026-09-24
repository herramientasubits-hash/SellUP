/**
 * GET /api/debug/agent1-provider-scorecard
 *
 * AGENT1-PROVIDER-RUN-SCORECARD-1 — la ficha por corrida y proveedor de una
 * ventana de fechas, para comparar a Apollo con Lusha con la misma vara.
 *
 * Parámetros (todos validados en `parseProviderRunScorecardRequest`):
 *   from=YYYY-MM-DD            inicio inclusivo (obligatorio)
 *   to=YYYY-MM-DD              fin exclusivo (por omisión, un día)
 *   country=CO                 filtro opcional por país del lote
 *   industry=Retail            filtro opcional por industria del lote
 *   lusha_usd_per_credit=…     precio SIMULADO; no toca `provider_pricing_config`
 *   apollo_usd_per_credit=…    ídem
 *
 * Acceso: admin-only (sesión autenticada + `is_admin`). Sólo lectura: sin
 * escrituras, sin RPC de negocio, sin llamadas a proveedores, sin gasto.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  buildProviderRunScorecard,
  summarizeProviderRunScorecard,
} from '@/modules/agent1-effectiveness/provider-run-scorecard';
import { parseProviderRunScorecardRequest } from '@/modules/agent1-effectiveness/provider-run-scorecard-request';
import { loadProviderRunScorecardInput } from '@/modules/agent1-effectiveness/provider-run-scorecard-queries';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { data: isAdmin } = await supabase.rpc('is_admin', {
    p_auth_user_id: user.id,
  });
  if (!isAdmin) {
    return NextResponse.json({ error: 'Acceso restringido a administradores' }, { status: 403 });
  }

  const parsed = parseProviderRunScorecardRequest(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const input = await loadProviderRunScorecardInput(parsed.request);
    const rows = buildProviderRunScorecard(input);
    return NextResponse.json({
      scorecard_version: 'agent1_provider_run_scorecard_v1',
      window: { from: parsed.request.dateFrom, to: parsed.request.dateTo },
      filters: { country: parsed.request.countryCode, industry: parsed.request.industry },
      prices: input.prices,
      summary: summarizeProviderRunScorecard(rows),
      rows,
    });
  } catch (error) {
    console.error('[agent1-provider-scorecard] load failed', error);
    return NextResponse.json({ error: 'No se pudo cargar la ficha' }, { status: 500 });
  }
}
