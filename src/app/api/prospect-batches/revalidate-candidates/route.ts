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

    const body = await request.json() as { batchId?: string };
    const { batchId } = body;

    if (!batchId || typeof batchId !== 'string') {
      return NextResponse.json({ error: 'batchId es requerido' }, { status: 400 });
    }

    const result = await validateImportedCandidatesBatch(batchId, user.id, supabase);

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Error en revalidación' }, { status: 422 });
    }

    return NextResponse.json({ success: true, batchId });
  } catch (err) {
    console.error('[revalidate-candidates] Error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
