/**
 * run-progress.server.ts — escritura y lectura de `agent1_run_progress`
 * (migración 143). Ver `run-progress.ts` para las reglas.
 *
 * Escribe service_role (el vendedor no tiene permiso de escritura); lee la
 * sesión del vendedor, y la RLS solo le deja ver su propia fila.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createWizardBudgetServiceClient } from './wizard-budget-preflight.server';
import {
  RUN_PROGRESS_STAGES,
  createRunProgressReporter,
  readClientRequestId,
  type RunProgressStage,
  type RunProgressStore,
} from './run-progress';

const TABLE = 'agent1_run_progress';
/** Filas de corridas viejas que se barren al empezar una nueva (sin cron). */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function logProgressError(error: unknown): void {
  console.warn('[agent1-run-progress] no se pudo anotar la etapa', error);
}

function createStore(
  admin: SupabaseClient,
  authUserId: string,
  clientRequestId: string,
): RunProgressStore {
  const key = { created_by: authUserId, client_request_id: clientRequestId };
  return {
    write: async ({ stage, label }) => {
      const { error } = await admin
        .from(TABLE)
        .upsert({ ...key, stage, label, updated_at: new Date().toISOString() }, {
          onConflict: 'created_by,client_request_id',
        });
      if (error) throw error;
    },
    clear: async () => {
      const { error } = await admin.from(TABLE).delete().match(key);
      if (error) throw error;
    },
  };
}

/**
 * El anotador de una corrida. Sin `clientRequestId` válido, sin sesión o sin
 * credenciales devuelve un anotador mudo: la corrida no depende de esto.
 */
export async function openRunProgress(
  request: unknown,
): Promise<{ report: (stage: RunProgressStage) => void; finish: () => Promise<void> }> {
  const silent = { report: () => {}, finish: async () => {} };
  const clientRequestId = readClientRequestId(request);
  if (!clientRequestId) return silent;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return silent;
    const admin = createWizardBudgetServiceClient();
    // Barrido perezoso de corridas que nunca cerraron (proceso muerto).
    void admin
      .from(TABLE)
      .delete()
      .lt('updated_at', new Date(Date.now() - STALE_AFTER_MS).toISOString())
      .then(({ error }) => {
        if (error) logProgressError(error);
      });
    return createRunProgressReporter(createStore(admin, user.id, clientRequestId), logProgressError);
  } catch (error) {
    logProgressError(error);
    return silent;
  }
}

export type RunProgressSnapshot = { stage: RunProgressStage; label: string } | null;

/** La etapa actual de MI corrida, o `null` si no hay (o no se pudo leer). */
export async function readRunProgress(clientRequestId: string): Promise<RunProgressSnapshot> {
  if (!readClientRequestId({ clientRequestId })) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select('stage, label')
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (error || !data) return null;
    const stage = (RUN_PROGRESS_STAGES as readonly string[]).includes(data.stage)
      ? (data.stage as RunProgressStage)
      : null;
    if (!stage || typeof data.label !== 'string') return null;
    return { stage, label: data.label };
  } catch {
    return null;
  }
}
