// ── Importar archivo: país de cada fila (dueña 13-11) ────────────────────────
// POST /api/prospect-batches/detect-import-countries
// Server-only. Recibe SÓLO las filas sin país (nombre, web, ciudad…) y devuelve
// el país detectado de cada una: primero sin IA (dominio, texto de la fila) y,
// para las que falten, Claude en una sola llamada. No guarda nada.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  IMPORT_COUNTRY_DETECTION_MAX_ROWS,
  type CountryDetectionRow,
} from '@/server/prospect-batches/import-country-detection';
import { runLiveImportCountryDetection } from '@/server/prospect-batches/import-country-detection.server';

export const maxDuration = 120;

function text(value: unknown, max = 400): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .single();
    if (!internalUser) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 });

    const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
    if (!Array.isArray(body?.rows)) {
      return NextResponse.json({ success: false, message: 'Faltan las filas.' }, { status: 400 });
    }
    const rows: CountryDetectionRow[] = [];
    for (const entry of body.rows.slice(0, IMPORT_COUNTRY_DETECTION_MAX_ROWS)) {
      if (!entry || typeof entry !== 'object') continue;
      const r = entry as Record<string, unknown>;
      const name = text(r.company_name, 200);
      if (typeof r.index !== 'number' || !Number.isInteger(r.index) || !name) continue;
      rows.push({
        index: r.index,
        company_name: name,
        website: text(r.website, 200),
        city: text(r.city, 120),
        region: text(r.region, 120),
        description: text(r.description),
        notes: text(r.notes),
        tax_identifier: text(r.tax_identifier, 40),
      });
    }
    if (rows.length === 0) return NextResponse.json({ success: true, detections: [], aiUnavailable: false });

    const outcome = await runLiveImportCountryDetection(rows, internalUser.id as string);
    return NextResponse.json({
      success: true,
      detections: outcome.detections,
      aiUnavailable: outcome.errorCode === 'ai_unavailable',
      aiError: outcome.errorCode && outcome.errorCode !== 'ai_unavailable' ? outcome.errorCode : null,
    });
  } catch (err) {
    console.error('[detect-import-countries] failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, message: 'No se pudo detectar el país de las filas.' }, { status: 500 });
  }
}
