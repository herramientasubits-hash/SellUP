import { NextResponse, type NextRequest } from 'next/server';
import { isAgent3FirstCallEnabled } from '@/lib/feature-flags.server';
import { parseFirstCallRequest } from '@/modules/speech/first-call-request';
import { parseFirstContactRunMeta } from '@/modules/speech/first-contact-run-registry';
import { resolveActiveInternalUserId } from '@/server/agents/first-call/request-user.server';
import { runFirstCall } from '@/server/agents/first-call/run-first-call';
import { buildLiveFirstCallDeps } from '@/server/agents/first-call/run-first-call.server';
import { recordFirstContactRunFinish, recordFirstContactRunStart } from '@/server/agents/first-call/run-registry.server';

/**
 * Agente 3 · Primera llamada (AGENT3-FIRST-CALL-1).
 *
 * POST: investiga la empresa (si no hay ficha vigente) y prepara la primera llamada
 * para el decisor y el canal elegidos. Mientras corre, el navegador lee el avance
 * con `/api/agent3/first-call/live` (columna `progress_stage` de la ficha y la fila
 * de la corrida en `agent_runs`, si vino `run` en la solicitud).
 */
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };
const UNEXPECTED_MESSAGE = 'Algo falló al preparar la llamada. Vuelve a intentarlo.';

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

  const userId = await resolveActiveInternalUserId();
  if (userId === null) return NextResponse.json({ ok: false, code: 'unauthorized', message: 'Inicia sesión.' }, { status: 401 });
  if (userId === 'forbidden') {
    return NextResponse.json({ ok: false, code: 'forbidden', message: 'Tu usuario no tiene acceso.' }, { status: 403 });
  }

  // La corrida queda en el servidor (si el navegador mandó su id): se ve desde otro equipo
  // y, si Vercel corta la función, el barrido la cierra. Si no se pudo registrar, sigue igual.
  const runMeta = parseFirstContactRunMeta(body);
  const recorded = runMeta ? await recordFirstContactRunStart({ meta: runMeta, accountId: parsed.request.accountId, userId }) : false;
  const finish = async (result: Parameters<typeof recordFirstContactRunFinish>[0]['result']) => {
    if (recorded && runMeta) await recordFirstContactRunFinish({ runId: runMeta.id, userId, meta: runMeta, result });
  };

  try {
    const result = await runFirstCall(parsed.request, buildLiveFirstCallDeps(userId, { agentRunId: recorded ? runMeta!.id : null }));
    await finish(result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error('[agent3] first-call run failed:', err instanceof Error ? err.message : err);
    await finish({ ok: false, code: 'unexpected_error', message: UNEXPECTED_MESSAGE });
    return NextResponse.json({ ok: false, code: 'unexpected_error', message: UNEXPECTED_MESSAGE }, { status: 500, headers: NO_STORE });
  }
}
