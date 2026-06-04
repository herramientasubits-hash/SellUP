import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { lookupTaxIdentifierForCandidate } from '@/server/prospect-batches/tax-identifier-lookup';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { candidateId } = body;

    if (!candidateId || typeof candidateId !== 'string') {
      return NextResponse.json({ error: 'Falta candidateId válido' }, { status: 400 });
    }

    const result = await lookupTaxIdentifierForCandidate({
      candidateId,
      userId: user.id,
      supabase,
    });

    if (!result.success) {
      const isUserError =
        result.error === 'TAX_IDENTIFIER_ALREADY_PRESENT' ||
        result.error === 'CANDIDATE_NOT_FOUND';
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          message: result.message,
          lookup: result.lookup,
        },
        { status: isUserError ? 400 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      candidate_id: result.candidate_id,
      lookup: result.lookup,
      message: result.message,
    });
  } catch (err) {
    console.error('[lookup-tax-identifier] Error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
