/**
 * POST /api/cron/bulk-search-rounds
 *
 * La búsqueda masiva corre sola en el servidor (dueña 28-10). Corre UNA ronda a
 * nombre de quien lanzó la búsqueda y, si queda trabajo, pide la siguiente.
 *
 * No la llama Vercel Cron (el plan sólo admite crons diarios y los dos están
 * ocupados): la llama el propio servidor al crear la búsqueda y al terminar cada
 * ronda. Por eso vive bajo `api/cron/`: sin cookie de sesión, excluida del proxy y
 * autenticada SÓLO con `CRON_SECRET`, fail-closed como los demás.
 *
 * Responde 202 al aceptar y trabaja después (`after`): quien la llama no espera
 * los minutos de la ronda, y la espera entre rondas la hace el paso siguiente con
 * su propio tiempo. Apagada (`ENABLE_GROWTH_BULK_SEARCH_SERVER_RUNNER`), no hace nada.
 */
import { NextResponse, after } from 'next/server';
import {
  authorizeRecoveryCronRequest,
  extractCronSecretFromAuthorizationHeader,
} from '@/modules/contact-enrichment/phone-reveal-recovery-cron-core';
import { decideServerChain, parseServerChainRequest } from '@/modules/prospect-batches/bulk-search/bulk-search-server-chain';

export const dynamic = 'force-dynamic';
// La ronda es una corrida normal del asistente: el mismo tiempo que su ruta.
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const auth = authorizeRecoveryCronRequest(
    extractCronSecretFromAuthorizationHeader(request.headers.get('Authorization')),
    process.env.CRON_SECRET,
  );
  if (!auth.authorized) {
    console.warn(`[BulkSearchServerRunner] pedido no autorizado (${auth.denialCode}).`);
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: NO_STORE });
  }
  // El conductor (sesión, base, corrida) sólo se carga después de autorizar.
  const [{ isBulkSearchServerRunnerEnabled }, { kickServerRound }, { runBulkSearchRoundOnServer }] = await Promise.all([
    import('@/modules/prospect-batches/bulk-search/bulk-search-flag.server'),
    import('@/modules/prospect-batches/bulk-search/bulk-search-server-kick.server'),
    import('@/modules/prospect-batches/bulk-search/bulk-search-server-runner.server'),
  ]);
  if (!isBulkSearchServerRunnerEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'flag_off' }, { headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const chain = parseServerChainRequest(body);
  if (!chain) return NextResponse.json({ ok: false, error: 'Petición inválida.' }, { status: 400, headers: NO_STORE });

  after(async () => {
    // Una espera se hace en un paso propio: así la ronda siempre arranca con los
    // 300 s enteros que su corrida da por hechos.
    if (chain.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, chain.delayMs));
      await kickServerRound({ ...chain, delayMs: 0 });
      return;
    }
    const outcome = await runBulkSearchRoundOnServer(chain.bulkSearchId);
    if (!outcome.ok) {
      // La búsqueda queda como está; la retoma el navegador de quien la lanzó.
      console.warn(`[BulkSearchServerRunner] ${chain.bulkSearchId}: se detiene (${outcome.reason}).`);
      return;
    }
    const decision = decideServerChain(outcome.response, chain.consecutiveWaits);
    if (decision.kind === 'stop') return;
    await kickServerRound({
      bulkSearchId: chain.bulkSearchId,
      consecutiveWaits: decision.consecutiveWaits,
      delayMs: decision.delayMs,
    });
  });

  return NextResponse.json({ ok: true, accepted: true }, { status: 202, headers: NO_STORE });
}
