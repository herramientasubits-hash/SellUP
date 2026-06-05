import { NextRequest, NextResponse } from 'next/server';
import { runEnrichmentWorker } from '@/server/prospect-batches/enrichment-worker';

export const dynamic = 'force-dynamic';

async function handleCronRequest(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET || 'local_cron_secret';

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[CronEnrich] Unauthorized attempt to trigger cron endpoint.');
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    console.info('[CronEnrich] Starting enrichment worker run...');
    const stats = await runEnrichmentWorker();

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
