import { NextRequest, NextResponse } from 'next/server';
// AGENT1-IMPORT-PARITY-7 — la MISMA autorización fail-closed del cron de
// recuperación de teléfonos: sin `CRON_SECRET` configurado nadie entra. Antes
// caía a un secreto público (`local_cron_secret`) que cualquiera podía enviar.
import {
  authorizeRecoveryCronRequest,
  extractCronSecretFromAuthorizationHeader,
} from '@/modules/contact-enrichment/phone-reveal-recovery-cron-core';
// AGENT1-IMPORT-PARITY-10 — el cron vacía la cola con el mismo presupuesto que la importación.
import { drainEnrichmentJobs } from '@/server/prospect-batches/enrichment-drain';

export const dynamic = 'force-dynamic';

async function handleCronRequest(request: NextRequest) {
  try {
    const auth = authorizeRecoveryCronRequest(
      extractCronSecretFromAuthorizationHeader(request.headers.get('Authorization')),
      process.env.CRON_SECRET,
    );

    if (!auth.authorized) {
      console.warn(`[CronEnrich] Unauthorized attempt to trigger cron endpoint (${auth.denialCode}).`);
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    console.info('[CronEnrich] Starting enrichment worker run...');
    const stats = await drainEnrichmentJobs();

    return NextResponse.json({
      success: true,
      message: 'Worker ejecutado exitosamente',
      stats,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[CronEnrich] Exception during worker execution:', err);
    
    // Evitar exponer detalles de credenciales o de infraestructura interna
    return NextResponse.json({
      error: 'Error interno durante el procesamiento del enriquecimiento',
      details: process.env.NODE_ENV === 'development' ? errMsg : undefined,
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}

export async function POST(request: NextRequest) {
  return handleCronRequest(request);
}
