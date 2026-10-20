import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirstContactRunsLive } from '@/modules/speech/actions';
import { parseLiveItems } from '@/modules/speech/first-contact-live';

/**
 * Agente 3 · el avance de las preparaciones en curso (para el panel y el Centro de
 * procesos). Es una ruta y no una acción del servidor a propósito (Prod 19-10): el
 * navegador manda las acciones del servidor UNA A LA VEZ y las navegaciones esperan
 * detrás; con sondeos cada pocos segundos, Empresas se quedaba cargando.
 *
 * POST { items: [{ runId, accountId, sinceIso }] } → { [runId]: { stage, packStatuses } }.
 * Cada empresa se lee con el permiso de quien pregunta (`getAccountById`).
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }
  const items = parseLiveItems(body);
  if (!items) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  try {
    return NextResponse.json(await getFirstContactRunsLive(items), { headers: NO_STORE });
  } catch (err) {
    console.error('[agent3] live progress failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500, headers: NO_STORE });
  }
}
