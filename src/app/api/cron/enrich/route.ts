import { after, NextRequest, NextResponse } from 'next/server';
// AGENT1-IMPORT-PARITY-7 — la MISMA autorización fail-closed del cron de
// recuperación de teléfonos: sin `CRON_SECRET` configurado nadie entra. Antes
// caía a un secreto público (`local_cron_secret`) que cualquiera podía enviar.
import {
  authorizeRecoveryCronRequest,
  extractCronSecretFromAuthorizationHeader,
} from '@/modules/contact-enrichment/phone-reveal-recovery-cron-core';
import { parseEnrichmentHop } from '@/server/prospect-batches/enrichment-drain';

export const dynamic = 'force-dynamic';
// FEEDBACK 24-11 — cada vuelta encadenada vacía hasta 180 s en su propio `after()`.
export const maxDuration = 300;

/**
 * Vacía la cola de enriquecimiento de lo importado. La llaman la importación (cuando su
 * vaciado se quedó sin tiempo) y la vuelta anterior (`enrichment-chain.server.ts`), con
 * `{ hop }`. Responde 202 al instante: el trabajo corre en `after()` y, si queda cola,
 * pide la vuelta siguiente.
 */
async function handleCronRequest(request: NextRequest, hop: number) {
  const auth = authorizeRecoveryCronRequest(
    extractCronSecretFromAuthorizationHeader(request.headers.get('Authorization')),
    process.env.CRON_SECRET,
  );
  if (!auth.authorized) {
    console.warn(`[CronEnrich] Unauthorized attempt to trigger cron endpoint (${auth.denialCode}).`);
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  after(async () => {
    try {
      const { runEnrichmentChainHop } = await import('@/server/prospect-batches/enrichment-chain.server');
      await runEnrichmentChainHop(hop);
    } catch (err) {
      console.error('[CronEnrich] hop failed; remaining jobs stay pending:', err instanceof Error ? err.message : err);
    }
  });
  return NextResponse.json({ accepted: true, hop }, { status: 202 });
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request, 0);
}

export async function POST(request: NextRequest) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return handleCronRequest(request, parseEnrichmentHop(body));
}
