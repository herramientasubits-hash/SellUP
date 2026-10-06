/**
 * POST /api/cron/claude-rescue-continuation
 *
 * SOURCES-EC-CLOSE-2 — la siguiente vuelta del rescate con Claude de UN lote, en una
 * función nueva de Vercel. La pide la vuelta anterior cuando quedó trabajo
 * (`rescue-chain.server.ts`); como mucho 4 vueltas extra y US$3 por lote
 * (`rescue-chain.ts`, decisión de la dueña 06-10).
 *
 * Misma autorización fail-closed que los crons: sin `CRON_SECRET` nadie entra.
 * Responde 202 al instante y hace el trabajo en su propio `after()`.
 */
import { after, NextRequest, NextResponse } from 'next/server';
import {
  authorizeRecoveryCronRequest,
  extractCronSecretFromAuthorizationHeader,
} from '@/modules/contact-enrichment/phone-reveal-recovery-cron-core';
import { isAgent1ClaudeRescueEnabled } from '@/lib/feature-flags.server';
import { parseRescueContinuationRequest } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-chain';
import { computeBackgroundRescueDeadlineMs } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-time-budget';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const startedAtMs = Date.now();
  const auth = authorizeRecoveryCronRequest(
    extractCronSecretFromAuthorizationHeader(request.headers.get('Authorization')),
    process.env.CRON_SECRET,
  );
  if (!auth.authorized) {
    console.warn(`[claude-rescue] Unauthorized continuation attempt (${auth.denialCode}).`);
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  if (!isAgent1ClaudeRescueEnabled()) {
    return NextResponse.json({ accepted: false, reason: 'rescue_disabled' }, { status: 200 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const parsed = parseRescueContinuationRequest(body);
  if (parsed === null) return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });

  after(async () => {
    const deadlineMs = computeBackgroundRescueDeadlineMs(startedAtMs, Date.now());
    if (deadlineMs === null) return;
    const { runRescueRound } = await import(
      '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-chain.server'
    );
    await runRescueRound({
      batchId: parsed.batchId,
      triggeredBy: parsed.triggeredBy,
      deadlineMs,
      continuationsDone: parsed.continuation,
      spentBeforeUsd: parsed.spentUsd,
    });
  });
  return NextResponse.json({ accepted: true, continuation: parsed.continuation }, { status: 202 });
}
