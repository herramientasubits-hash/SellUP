import { NextResponse, type NextRequest } from 'next/server';
import { resolveActiveInternalUserId } from '@/server/agents/first-call/request-user.server';
import {
  dismissFirstContactRuns,
  listFirstContactRuns,
  sweepStaleFirstContactRuns,
} from '@/server/agents/first-call/run-registry.server';

/**
 * Agente 3 · las corridas de quien pregunta, guardadas en el servidor (`agent_runs`).
 *
 * GET → { runs }: las de las últimas 24 h que no quitó (el Centro de procesos las trae al
 * abrir la página, también en otro equipo). POST { dismiss: [ids] }: «Quitar» las
 * terminadas. Siempre sólo las propias.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

async function requireUser(): Promise<string | NextResponse> {
  const userId = await resolveActiveInternalUserId();
  if (userId === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  if (userId === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  return userId;
}

export async function GET() {
  const userId = await requireUser();
  if (typeof userId !== 'string') return userId;
  await sweepStaleFirstContactRuns();
  return NextResponse.json({ runs: await listFirstContactRuns(userId) }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }
  const ids = (body as { dismiss?: unknown } | null)?.dismiss;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }
  const userId = await requireUser();
  if (typeof userId !== 'string') return userId;
  await dismissFirstContactRuns(userId, ids as string[]);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
