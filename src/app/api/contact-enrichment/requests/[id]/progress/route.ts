import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { contactSearchProgress, type ContactSearchAttemptRow } from '@/modules/contact-enrichment/contact-search-progress';
import { activeInternalUserIdForRoute } from '@/modules/contact-enrichment/route-auth.server';

/**
 * El avance real de una búsqueda de contactos (sólo lectura): sus intentos por proveedor
 * y cuántos candidatos ya dejó para revisar. Lo consulta el panel cada pocos segundos.
 */
const NO_STORE = { 'Cache-Control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await activeInternalUserIdForRoute())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid_request_id' }, { status: 400, headers: NO_STORE });

  const supabase = await createClient();
  const { data: runs, error } = await supabase
    .from('contact_enrichment_runs')
    .select('id, attempt_order, intended_provider, status')
    .eq('request_id', id);
  if (error) return NextResponse.json({ error: 'read_failed' }, { status: 500, headers: NO_STORE });

  const rows = (runs ?? []) as Array<{ id: string; attempt_order: number | null; intended_provider: string | null; status: string }>;
  let found = 0;
  if (rows.length > 0) {
    const { count } = await supabase
      .from('contact_enrichment_candidates')
      .select('id', { count: 'exact', head: true })
      .in('enrichment_run_id', rows.map((r) => r.id));
    found = count ?? 0;
  }
  const attempts: ContactSearchAttemptRow[] = rows.map((r) => ({ attemptOrder: r.attempt_order, provider: r.intended_provider, status: r.status }));
  return NextResponse.json({ progress: contactSearchProgress(attempts, found) }, { headers: NO_STORE });
}
