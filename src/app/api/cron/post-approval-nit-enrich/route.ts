import { NextRequest, NextResponse } from 'next/server';
import { runPostApprovalNitEnrichmentWorker } from '@/server/prospect-batches/post-approval-nit-enrichment-worker';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 5;
const MAX_ALLOWED_LIMIT = 20;

async function handleCronRequest(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET || 'local_cron_secret';

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      console.warn(
        '[CronPostApprovalNitEnrich] Unauthorized attempt to trigger cron endpoint.',
      );
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
