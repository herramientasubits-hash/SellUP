// Agente 2A — Bulk Enrichment Execute Route
// Hito 17A.10C — POST /api/contact-enrichment/bulk-runs/[id]/execute

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { executeBulkContactEnrichmentRun } from '@/modules/contact-enrichment/bulk-enrichment-runner';
import { canSeeContactEnrichmentBulkRun } from '@/modules/contact-enrichment/candidate-scope.server';

// Hasta 10 empresas en serie: el límite por defecto no alcanzaba (AGENT2-AUDIT-FIXES-1).
export const maxDuration = 300;

async function resolveInternalUser(
  authUserId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .eq('access_status', 'active')
    .maybeSingle();
  return data?.id ?? null;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let internalUserId: string | null = null;

    if (user) {
      internalUserId = await resolveInternalUser(user.id);
    }

    // En development permitir fallback al primer usuario activo
    if (!internalUserId && process.env.NODE_ENV === 'development') {
      const { data: fallback } = await supabase
        .from('internal_users')
        .select('id')
        .eq('access_status', 'active')
        .limit(1)
        .maybeSingle();
      internalUserId = fallback?.id ?? null;
    }

    if (!internalUserId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id: bulkRunId } = await params;

    if (!bulkRunId || typeof bulkRunId !== 'string' || !bulkRunId.trim()) {
      return NextResponse.json({ error: 'bulk run id inválido' }, { status: 400 });
    }

    // Alcance comercial: sólo se ejecuta una búsqueda masiva propia (o del equipo, o admin).
    // Una ajena responde como inexistente y no gasta créditos.
    if (!(await canSeeContactEnrichmentBulkRun(supabase, bulkRunId))) {
      return NextResponse.json({ error: 'Búsqueda masiva no encontrada' }, { status: 404 });
    }

    const result = await executeBulkContactEnrichmentRun({
      bulkRunId: bulkRunId.trim(),
      triggeredByUserId: internalUserId,
    });

    return NextResponse.json({
      bulkRunId: result.bulkRunId,
      status: result.status,
      totalProcessed: result.totalProcessed,
      totalSucceeded: result.totalSucceeded,
      totalFailed: result.totalFailed,
      totalCandidatesCreated: result.totalCandidatesCreated,
      summary: result.summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    // No exponer stack traces
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
