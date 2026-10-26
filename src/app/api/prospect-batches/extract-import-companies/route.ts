// ── Leer empresas de un texto libre — IMPORT-FREE-FORMAT-1 ───────────────────
// POST /api/prospect-batches/extract-import-companies
// Server-only. Claude separa las empresas de un texto corrido (correo, notas,
// párrafo) para la vista previa de la importación. No guarda nada.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { IMPORT_AI_EXTRACTION_MAX_INPUT_CHARS } from '@/server/prospect-batches/import-ai-extraction';
import { runLiveImportAiExtraction } from '@/server/prospect-batches/import-ai-extraction.server';

export const maxDuration = 150;

/** Más que esto ni siquiera se recorta: es un archivo equivocado. */
const MAX_REQUEST_CHARS = IMPORT_AI_EXTRACTION_MAX_INPUT_CHARS * 5;

const ERROR_MESSAGES: Record<string, string> = {
  claude_not_configured: 'La lectura con IA no está activa. Pide a un administrador que la active en Configuración → IA.',
  claude_quota_exhausted: 'La IA no tiene cuota disponible este mes. Pega una tabla o una lista, una empresa por línea.',
  output_too_long: 'El texto trae demasiadas empresas para leerlas de una vez. Pégalo en partes más pequeñas.',
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .single();
    if (!internalUser) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return NextResponse.json({ success: false, message: 'No hay texto para leer.' }, { status: 400 });
    }
    if (text.length > MAX_REQUEST_CHARS) {
      return NextResponse.json(
        { success: false, message: 'El texto es demasiado largo. Pégalo en partes más pequeñas.' },
        { status: 413 },
      );
    }

    const outcome = await runLiveImportAiExtraction(text, internalUser.id as string);
    if (outcome.errorCode) {
      return NextResponse.json({
        success: false,
        code: outcome.errorCode,
        message: ERROR_MESSAGES[outcome.errorCode] ?? 'No se pudo leer el texto con IA. Intenta de nuevo.',
      }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      rows: outcome.rows,
      inputTruncated: 'inputTruncated' in outcome ? outcome.inputTruncated : false,
    });
  } catch (err) {
    console.error('[extract-import-companies] failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, message: 'No se pudo leer el texto con IA.' }, { status: 500 });
  }
}
