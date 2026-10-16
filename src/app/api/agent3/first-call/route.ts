import { NextResponse, type NextRequest } from 'next/server';
import { isAgent3FirstCallEnabled } from '@/lib/feature-flags.server';
import { createClient } from '@/lib/supabase/server';
import { parseFirstCallRequest } from '@/modules/speech/first-call-request';
import { runFirstCall } from '@/server/agents/first-call/run-first-call';
import { buildLiveFirstCallDeps } from '@/server/agents/first-call/run-first-call.server';

/**
 * Agente 3 · Primera llamada (AGENT3-FIRST-CALL-1).
 *
 * POST: investiga la empresa (si no hay ficha vigente) y prepara la primera llamada
 * para el decisor y el canal elegidos. Mientras corre, el navegador lee el avance
 * con `getFirstCallState` (columna `progress_stage` de la ficha).
 */
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  if (!isAgent3FirstCallEnabled()) {
    return NextResponse.json(
      { ok: false, code: 'disabled', message: 'La preparación de la primera llamada todavía no está activada.' },
      { status: 403, headers: NO_STORE },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_request', message: 'No pudimos leer la solicitud.' }, { status: 400 });
  }
  const parsed = parseFirstCallRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, code: 'invalid_request', message: 'Revisa los datos de la solicitud.' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, code: 'unauthorized', message: 'Inicia sesión.' }, { status: 401 });
  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();
  if (!internalUser) {
    return NextResponse.json({ ok: false, code: 'forbidden', message: 'Tu usuario no tiene acceso.' }, { status: 403 });
  }

  try {
    const result = await runFirstCall(parsed.request, buildLiveFirstCallDeps(internalUser.id as string));
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error('[agent3] first-call run failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, code: 'unexpected_error', message: 'Algo falló al preparar la llamada. Vuelve a intentarlo.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
