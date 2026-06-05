import { createClient } from '@supabase/supabase-js';
import { AUTO_ENRICH_CONFIG } from '@/modules/prospect-batches/auto-enrich-config';
import { enrichProspectCandidate } from './candidate-enrichment';
import { evaluateAutoEnrichmentEligibility } from './candidate-enrichment-eligibility';

function getAdminSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceKey) {
    throw new Error('enrichment_configuration_unavailable (SUPABASE_SERVICE_ROLE_KEY not configured)');
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

export interface WorkerExecutionStats {
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  jobsProcessed: Array<{
    jobId: string;
    candidateId: string;
    status: 'completed' | 'failed' | 'skipped';
    error?: string;
    skippedReason?: string;
  }>;
}

export async function runEnrichmentWorker(): Promise<WorkerExecutionStats> {
  const startTime = Date.now();
  const jobsProcessed: WorkerExecutionStats['jobsProcessed'] = [];

  if (!AUTO_ENRICH_CONFIG.enabled) {
    console.info('[EnrichmentWorker] Auto enrichment is disabled in configuration.');
    return {
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: Date.now() - startTime,
      jobsProcessed: [],
    };
  }

  const workerId = `worker-${crypto.randomUUID()}`;
  const supabase = getAdminSupabase();

  // 1. Reclamar trabajos de forma atómica usando la función RPC
  const { data: claimedJobs, error: claimError } = await supabase.rpc('claim_enrichment_jobs', {
    p_worker_id: workerId,
    p_limit: AUTO_ENRICH_CONFIG.workerBatchSize || 3,
    p_lock_duration_minutes: AUTO_ENRICH_CONFIG.lockDurationMinutes || 5,
  });

  if (claimError) {
    console.error('[EnrichmentWorker] Error claiming jobs from RPC:', claimError);
    throw claimError;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobs = (claimedJobs || []) as any[];
  console.info(`[EnrichmentWorker] Claimed ${jobs.length} jobs to process.`);

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  // Procesar con concurrencia limitada
  const concurrency = AUTO_ENRICH_CONFIG.workerConcurrency || 2;
  const chunks = [];
  for (let i = 0; i < jobs.length; i += concurrency) {
    chunks.push(jobs.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (job) => {
        try {
          // 2. Verificar estado actual del candidato antes de gastar IA
          const { data: candidate, error: candError } = await supabase
            .from('prospect_candidates')
            .select('*')
            .eq('id', job.candidate_id)
            .single();

          if (candError || !candidate) {
            const errMsg = candError?.message || 'Candidato no encontrado en base de datos';
            console.warn(`[EnrichmentWorker] Job ${job.id}: Candidate ${job.candidate_id} not found:`, errMsg);
            
            await supabase
              .from('prospect_enrichment_jobs')
              .update({
                status: 'skipped',
                completed_at: new Date().toISOString(),
                error_code: 'candidate_not_found',
                metadata: {
                  ...job.metadata,
                  error: errMsg,
                },
              })
              .eq('id', job.id);

            jobsProcessed.push({
              jobId: job.id,
              candidateId: job.candidate_id,
              status: 'skipped',
              error: errMsg,
            });
            skippedCount++;
            return;
          }

          // Verificar elegibilidad de autoenriquecimiento
          const eligibility = evaluateAutoEnrichmentEligibility(candidate);
          if (!eligibility.eligible) {
            const skipReason = eligibility.reason || 'No elegible para enriquecimiento';
            console.info(`[EnrichmentWorker] Job ${job.id}: Candidate ${job.candidate_id} is no longer eligible: ${skipReason}`);

            // Marcar el trabajo como omitido (skipped)
            await supabase
              .from('prospect_enrichment_jobs')
              .update({
                status: 'skipped',
                completed_at: new Date().toISOString(),
                metadata: {
                  ...job.metadata,
                  skip_reason: skipReason,
                },
              })
              .eq('id', job.id);

            // Sincronizar el estado del candidato en prospect_candidates para mantener el banner/tabla actualizados
            const existingMeta = candidate.metadata || {};
            await supabase
              .from('prospect_candidates')
              .update({
                metadata: {
                  ...existingMeta,
                  enrichment: {
                    ...(existingMeta.enrichment || {}),
                    status: eligibility.status, // skipped_duplicate, etc.
                    skip_reason: skipReason,
                    updated_at: new Date().toISOString(),
                  },
                },
              })
              .eq('id', candidate.id);

            jobsProcessed.push({
              jobId: job.id,
              candidateId: job.candidate_id,
              status: 'skipped',
              skippedReason: skipReason,
            });
            skippedCount++;
            return;
          }

          // 3. Ejecutar el pipeline de enriquecimiento actual
          // Nota: enrichProspectCandidate maneja el lock preventivo, tokens, costos y la persistencia
          const result = await enrichProspectCandidate({
            candidateId: job.candidate_id,
            userId: job.user_id,
            supabase,
            executionType: job.execution_type,
          });

          if (result.success) {
            // Actualizar trabajo como completado con éxito
            await supabase
              .from('prospect_enrichment_jobs')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                error_code: null,
                metadata: {
                  ...job.metadata,
                  result: result.data,
                },
              })
              .eq('id', job.id);

            jobsProcessed.push({
              jobId: job.id,
              candidateId: job.candidate_id,
              status: 'completed',
            });
            successCount++;
          } else {
            // Clasificar errores: verificar si es recuperable o definitivo
            const isMaxAttempts = job.attempts >= job.max_attempts;
            
            // Si no hay proveedores configurados en absoluto, es un error definitivo
            const isDefinitiveError = result.skipped || result.errorCode === 'no_ai_providers_configured' || isMaxAttempts;
            const isRecoverable = !isDefinitiveError;

            const lastErrorMsg = result.error || 'Error desconocido en pipeline';

            if (isRecoverable) {
              // Calcular backoff exponencial (ej. 30 * 2^attempts)
              const backoffSec = (AUTO_ENRICH_CONFIG.backoffSeconds || 30) * Math.pow(2, job.attempts);
              const nextRetry = new Date(Date.now() + backoffSec * 1000).toISOString();

              await supabase
                .from('prospect_enrichment_jobs')
                .update({
                  status: 'pending',
                  next_retry_at: nextRetry,
                  error_code: result.errorCode || 'api_error',
                  metadata: {
                    ...job.metadata,
                    last_error: lastErrorMsg,
                    last_attempt_at: new Date().toISOString(),
                  },
                })
                .eq('id', job.id);
              
              console.warn(`[EnrichmentWorker] Job ${job.id} failed, retry scheduled for ${nextRetry}. Error: ${lastErrorMsg}`);
            } else {
              // Error definitivo o máximo de intentos alcanzado
              await supabase
                .from('prospect_enrichment_jobs')
                .update({
                  status: 'failed',
                  completed_at: new Date().toISOString(),
                  error_code: result.errorCode || 'max_attempts_reached',
                  metadata: {
                    ...job.metadata,
                    last_error: lastErrorMsg,
                    last_attempt_at: new Date().toISOString(),
                  },
                })
                .eq('id', job.id);

              console.error(`[EnrichmentWorker] Job ${job.id} failed definitively. Error: ${lastErrorMsg}`);
            }

            jobsProcessed.push({
              jobId: job.id,
              candidateId: job.candidate_id,
              status: 'failed',
              error: lastErrorMsg,
            });
            failedCount++;
          }
        } catch (jobErr) {
          const errMsg = jobErr instanceof Error ? jobErr.message : String(jobErr);
          console.error(`[EnrichmentWorker] Unexpected error in job ${job.id}:`, jobErr);

          const isMaxAttempts = job.attempts >= job.max_attempts;
          if (!isMaxAttempts) {
            const nextRetry = new Date(Date.now() + 60 * 1000).toISOString(); // 1 minuto de espera
            await supabase
              .from('prospect_enrichment_jobs')
              .update({
                status: 'pending',
                next_retry_at: nextRetry,
                error_code: 'unexpected_worker_error',
                metadata: {
                  ...job.metadata,
                  last_error: errMsg,
                  last_attempt_at: new Date().toISOString(),
                },
              })
              .eq('id', job.id);
          } else {
            await supabase
              .from('prospect_enrichment_jobs')
              .update({
                status: 'failed',
                completed_at: new Date().toISOString(),
                error_code: 'unexpected_worker_error_final',
                metadata: {
                  ...job.metadata,
                  last_error: errMsg,
                  last_attempt_at: new Date().toISOString(),
                },
              })
              .eq('id', job.id);
          }

          jobsProcessed.push({
            jobId: job.id,
            candidateId: job.candidate_id,
            status: 'failed',
            error: errMsg,
          });
          failedCount++;
        }
      })
    );
  }

  const durationMs = Date.now() - startTime;
  console.info(`[EnrichmentWorker] Finished run. Total claimed: ${jobs.length}, Success: ${successCount}, Failed: ${failedCount}, Skipped: ${skippedCount}, Duration: ${durationMs}ms`);

  return {
    processedCount: jobs.length,
    successCount,
    failedCount,
    skippedCount,
    durationMs,
    jobsProcessed,
  };
}
