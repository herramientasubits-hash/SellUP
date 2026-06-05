import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { enrichProspectCandidate } from '@/server/prospect-batches/candidate-enrichment';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { candidateId, executionType } = body;

    if (!candidateId) {
      return NextResponse.json({ error: 'Falta candidateId' }, { status: 400 });
    }

    const result = await enrichProspectCandidate({
      candidateId,
      userId: user.id,
      supabase,
      executionType,
    });

    if (!result.success) {
      return NextResponse.json(
        { 
          error: result.error, 
          reason: result.reason, 
          skipped: result.skipped,
          errorCode: result.errorCode,
          errorDetails: result.errorDetails
        },
        { status: result.skipped ? 200 : 400 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (err) {
    console.error('[prospect-candidates-enrich] Error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
