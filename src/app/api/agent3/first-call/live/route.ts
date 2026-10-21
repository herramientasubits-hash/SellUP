import { NextResponse, type NextRequest } from 'next/server';
import { getFirstContactRunsLive } from '@/modules/speech/actions';
import { parseLiveItems } from '@/modules/speech/first-contact-live';
import { resolveActiveInternalUserId } from '@/server/agents/first-call/request-user.server';
import { listFirstContactRuns, sweepStaleFirstContactRuns } from '@/server/agents/first-call/run-registry.server';

/**
 * Agente 3 · el avance de las preparaciones en curso (para el panel y el Centro de
 * procesos). Es una ruta y no una acción del servidor a propósito (Prod 19-10): el
 * navegador manda las acciones del servidor UNA A LA VEZ y las navegaciones esperan
 * detrás; con sondeos cada pocos segundos, Empresas se quedaba cargando.
 *
 * POST { items: [{ runId, accountId, sinceIso }] } → { [runId]: { stage, packStatuses, run } }.
 * Cada empresa se lee con el permiso de quien pregunta (`getAccountById`); `run` es la
 * fila de la corrida en `agent_runs`, sólo de quien pregunta. Antes de leer se cierra lo
 * que Vercel cortó (como mucho una vez por minuto).
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

  const userId = await resolveActiveInternalUserId();
  if (userId === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  if (userId === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });

  try {
    await sweepStaleFirstContactRuns();
    const [live, runs] = await Promise.all([
      getFirstContactRunsLive(items),
      listFirstContactRuns(
        userId,
        items.map((item) => item.runId),
      ),
    ]);
    const byId = new Map(runs.map((run) => [run.id, run]));
    const out = Object.fromEntries(
      Object.entries(live).map(([runId, entry]) => {
        const run = byId.get(runId.toLowerCase());
        return [runId, { ...entry, run: run ? { status: run.status, packStatuses: run.packStatuses, message: run.message } : null }];
      }),
    );
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (err) {
    console.error('[agent3] live progress failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500, headers: NO_STORE });
  }
}
