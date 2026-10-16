import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateImportedCandidatesBatch } from '@/modules/prospect-batches/actions';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // AGENT1-AUDIT-WS1 — el validador escribe `prospect_enrichment_jobs.user_id`,
    // que apunta a `internal_users(id)`. Antes recibía el id de AUTH, la FK fallaba
    // y el trabajo no se encolaba (en silencio). Se exige además usuario ACTIVO,
    // igual que la importación.
    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .maybeSingle();
    if (!internalUser?.id) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 });
    }

    const body = await request.json() as { batchId?: string };
    const { batchId } = body;

    if (!batchId || typeof batchId !== 'string') {
      return NextResponse.json({ error: 'batchId es requerido' }, { status: 400 });
    }

    const result = await validateImportedCandidatesBatch(batchId, internalUser.id, supabase);

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Error en revalidación' }, { status: 422 });
    }

    return NextResponse.json({ success: true, batchId });
  } catch (err) {
    console.error('[revalidate-candidates] Error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
