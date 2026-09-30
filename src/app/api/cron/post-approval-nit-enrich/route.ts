import { NextRequest, NextResponse } from 'next/server';
// AGENT1-IMPORT-PARITY-7 — la MISMA autorización fail-closed del cron de
// recuperación de teléfonos: sin `CRON_SECRET` configurado nadie entra. Antes
// caía a un secreto público (`local_cron_secret`) que cualquiera podía enviar.
import {
  authorizeRecoveryCronRequest,
  extractCronSecretFromAuthorizationHeader,
} from '@/modules/contact-enrichment/phone-reveal-recovery-cron-core';
import { runPostApprovalNitEnrichmentWorker } from '@/server/prospect-batches/post-approval-nit-enrichment-worker';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 5;
const MAX_ALLOWED_LIMIT = 20;

async function handleCronRequest(request: NextRequest) {
  try {
    const auth = authorizeRecoveryCronRequest(
      extractCronSecretFromAuthorizationHeader(request.headers.get('Authorization')),
      process.env.CRON_SECRET,
    );

    if (!auth.authorized) {
      console.warn(`[CronPostApprovalNitEnrich] Unauthorized attempt to trigger cron endpoint (${auth.denialCode}).`);
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const url = new URL(request.url);
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit
      ? Math.min(Math.max(1, parseInt(rawLimit, 10) || DEFAULT_LIMIT), MAX_ALLOWED_LIMIT)
      : DEFAULT_LIMIT;

    console.info(
      `[CronPostApprovalNitEnrich] Starting post-approval NIT enrichment worker (limit=${limit})...`,
    );

    const stats = await runPostApprovalNitEnrichmentWorker({ maxCandidates: limit });

    return NextResponse.json({
      success: true,
      message: 'Post-approval NIT enrichment worker ejecutado exitosamente',
      stats,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(
      '[CronPostApprovalNitEnrich] Exception during worker execution:',
      err,
    );

    return NextResponse.json(
      {
        error: 'Error interno durante el procesamiento de enriquecimiento NIT post-aprobación',
        details:
          process.env.NODE_ENV === 'development' ? errMsg : undefined,
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}

export async function POST(request: NextRequest) {
  return handleCronRequest(request);
}
