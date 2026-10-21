/**
 * Agente 3 · el registro de corridas en `agent_runs` (sólo servidor).
 *
 * Nada de esto detiene una preparación: si la fila no se puede escribir, la corrida
 * sigue y el navegador la lleva como antes. Ver `first-contact-run-registry.ts`.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  FIRST_CONTACT_RUN_AGENT_KEY,
  FIRST_CONTACT_RUN_AGENT_NAME,
  FIRST_CONTACT_RUN_STALE_MS,
  FIRST_CONTACT_RUN_TIMEOUT_MESSAGE,
  FIRST_CONTACT_RUNS_LIST_HOURS,
  FIRST_CONTACT_RUNS_LIST_MAX,
  isFirstContactRunDismissed,
  isRunId,
  mapFirstContactRunRow,
  type FirstContactRunMeta,
  type FirstContactServerRun,
} from '@/modules/speech/first-contact-run-registry';
import { RESEARCH_RUNNING_STALE_MS } from './run-first-call.server';
import { AGENT3_VERSION } from './types';
import type { RunFirstCallResult } from './run-first-call';

const RUN_COLUMNS = 'id, status, input_params, metadata, started_at, finished_at, error_message, created_at';
/** El barrido corre en cada lectura del avance (cada 4 s por pestaña): como mucho uno por minuto. */
const SWEEP_EVERY_MS = 60_000;
let lastSweepAtMs = 0;

/** El cliente de servicio; las pruebas pasan uno falso. */
type AdminClient = Pick<ReturnType<typeof createSupabaseAdminClient>, 'from'>;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Registra la corrida al empezar. `true` si quedó la fila (sus consultas se enlazan a ella). */
export async function recordFirstContactRunStart(input: {
  meta: FirstContactRunMeta;
  accountId: string;
  userId: string;
}, client?: AdminClient): Promise<boolean> {
  try {
    const admin = client ?? createSupabaseAdminClient();
    const { error } = await admin.from('agent_runs').insert({
      id: input.meta.id,
      agent_key: FIRST_CONTACT_RUN_AGENT_KEY,
      agent_name: FIRST_CONTACT_RUN_AGENT_NAME,
      triggered_by: input.userId,
      status: 'running',
      input_params: { account_id: input.accountId, title: input.meta.title, expected: input.meta.expected },
      results_requested: input.meta.expected,
      metadata: { flow: 'agent3_first_call', agent_version: AGENT3_VERSION, account_name: input.meta.accountName },
      started_at: new Date().toISOString(),
    });
    if (error) {
      // 23505: el id ya existe (un reintento del mismo clic): no se pisa la fila de antes.
      console.error(`[agent3] run registry start failed (${error.code ?? 'no_code'}):`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[agent3] run registry start failed:', errorText(err));
    return false;
  }
}

/** Cómo terminó, en la fila. Sólo cierra una «en curso»: lo que el barrido ya cerró no revive. */
export async function recordFirstContactRunFinish(input: {
  runId: string;
  userId: string;
  meta: FirstContactRunMeta;
  result: RunFirstCallResult | { ok: false; code: 'unexpected_error'; message: string };
}, client?: AdminClient): Promise<void> {
  const { result } = input;
  const metadata: Record<string, unknown> = {
    flow: 'agent3_first_call',
    agent_version: AGENT3_VERSION,
    account_name: input.meta.accountName,
    ...(result.ok
      ? {
          brief_id: result.briefId,
          reused_brief: result.reusedBrief,
          pack_statuses: result.packStatuses,
          failed_targets: result.failedTargets,
          budget_stopped: result.budgetStopped,
        }
      : { error_code: result.code }),
  };
  try {
    const admin = client ?? createSupabaseAdminClient();
    const { error } = await admin
      .from('agent_runs')
      .update({
        status: result.ok ? 'completed' : 'failed',
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        results_generated: result.ok ? result.packIds.length : 0,
        error_message: result.ok ? null : result.message,
        metadata,
      })
      .eq('id', input.runId)
      .eq('triggered_by', input.userId)
      .eq('status', 'running');
    if (error) console.error('[agent3] run registry finish failed:', error.message);
  } catch (err) {
    console.error('[agent3] run registry finish failed:', errorText(err));
  }
}

/**
 * Cierra lo que quedó «en curso» porque Vercel cortó la función (no llega a ningún
 * `finally`): las corridas de más de 6 minutos, las investigaciones de más de 5 y el
 * «escribiendo» de una ficha reutilizada cuya corrida se cortó. Como mucho uno por minuto.
 */
export async function sweepStaleFirstContactRuns(nowMs: number = Date.now(), client?: AdminClient): Promise<void> {
  if (nowMs - lastSweepAtMs < SWEEP_EVERY_MS) return;
  lastSweepAtMs = nowMs;
  try {
    const admin = client ?? createSupabaseAdminClient();
    const finishedAt = new Date(nowMs).toISOString();
    const [runs, briefs] = await Promise.all([
      admin
        .from('agent_runs')
        .update({ status: 'failed', finished_at: finishedAt, updated_at: finishedAt, error_message: FIRST_CONTACT_RUN_TIMEOUT_MESSAGE })
        .eq('agent_key', FIRST_CONTACT_RUN_AGENT_KEY)
        .eq('status', 'running')
        .lt('started_at', new Date(nowMs - FIRST_CONTACT_RUN_STALE_MS).toISOString())
        .select('input_params'),
      admin
        .from('account_research_briefs')
        .update({ status: 'failed', progress_stage: null, error_code: 'stale_running', completed_at: finishedAt })
        .eq('status', 'running')
        .lt('created_at', new Date(nowMs - RESEARCH_RUNNING_STALE_MS).toISOString())
        .select('id'),
    ]);
    if (runs.error) console.error('[agent3] sweep runs failed:', runs.error.message);
    if (briefs.error) console.error('[agent3] sweep briefs failed:', briefs.error.message);
    const swept = (runs.data ?? []) as Array<{ input_params: { account_id?: unknown } | null }>;
    const accountIds = [...new Set(swept.map((r) => r.input_params?.account_id).filter(isRunId))];
    if (swept.length > 0 || (briefs.data ?? []).length > 0) {
      console.warn(`[agent3] sweep closed ${swept.length} run(s) and ${(briefs.data ?? []).length} research brief(s) left running`);
    }
    if (accountIds.length === 0) return;
    // Una ficha reutilizada queda «escribiendo» si su corrida se cortó; sólo se baja si
    // ninguna otra corrida de esa empresa sigue en curso.
    const { data: stillRunning } = await admin
      .from('agent_runs')
      .select('input_params')
      .eq('agent_key', FIRST_CONTACT_RUN_AGENT_KEY)
      .eq('status', 'running');
    const busy = new Set(((stillRunning ?? []) as Array<{ input_params: { account_id?: unknown } | null }>).map((r) => r.input_params?.account_id));
    const idle = accountIds.filter((id) => !busy.has(id));
    if (idle.length === 0) return;
    const { error } = await admin
      .from('account_research_briefs')
      .update({ progress_stage: 'done' })
      .in('account_id', idle)
      .neq('status', 'running')
      .eq('progress_stage', 'writing');
    if (error) console.error('[agent3] sweep writing stage failed:', error.message);
  } catch (err) {
    console.error('[agent3] sweep failed:', errorText(err));
  }
}

/** Las corridas de quien pregunta: las pedidas por id, o las de las últimas 24 h sin quitar. */
export async function listFirstContactRuns(
  userId: string,
  ids?: readonly string[],
  client?: AdminClient,
): Promise<FirstContactServerRun[]> {
  // El panel consulta con «panel» (no es una corrida): sin ids válidos no se consulta.
  const valid = ids?.filter(isRunId).map((id) => id.toLowerCase());
  if (valid && valid.length === 0) return [];
  try {
    const admin = client ?? createSupabaseAdminClient();
    let query = admin.from('agent_runs').select(RUN_COLUMNS).eq('agent_key', FIRST_CONTACT_RUN_AGENT_KEY).eq('triggered_by', userId);
    if (valid) {
      query = query.in('id', valid.slice(0, FIRST_CONTACT_RUNS_LIST_MAX));
    } else {
      query = query
        .gte('created_at', new Date(Date.now() - FIRST_CONTACT_RUNS_LIST_HOURS * 3_600_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(FIRST_CONTACT_RUNS_LIST_MAX * 2);
    }
    const { data, error } = await query;
    if (error) {
      console.error('[agent3] run registry list failed:', error.message);
      return [];
    }
    return ((data ?? []) as Record<string, unknown>[])
      .filter((row) => ids !== undefined || !isFirstContactRunDismissed(row))
      .map(mapFirstContactRunRow)
      .filter((run): run is FirstContactServerRun => run !== null)
      .slice(0, FIRST_CONTACT_RUNS_LIST_MAX);
  } catch (err) {
    console.error('[agent3] run registry list failed:', errorText(err));
    return [];
  }
}

/** «Quitar» en el Centro de procesos: deja de salir en los demás equipos. Las en curso se quedan. */
export async function dismissFirstContactRuns(
  userId: string,
  ids: readonly string[],
  client?: AdminClient,
): Promise<void> {
  const valid = ids.filter(isRunId).slice(0, FIRST_CONTACT_RUNS_LIST_MAX);
  if (valid.length === 0) return;
  try {
    const admin = client ?? createSupabaseAdminClient();
    const { data, error } = await admin
      .from('agent_runs')
      .select('id, metadata')
      .eq('agent_key', FIRST_CONTACT_RUN_AGENT_KEY)
      .eq('triggered_by', userId)
      .neq('status', 'running')
      .in('id', valid);
    if (error) throw new Error(error.message);
    const dismissedAt = new Date().toISOString();
    await Promise.all(
      ((data ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>).map(async (row) => {
        const update = await admin
          .from('agent_runs')
          .update({ metadata: { ...(row.metadata ?? {}), dismissed_at: dismissedAt } })
          .eq('id', row.id)
          .eq('triggered_by', userId);
        if (update.error) console.error('[agent3] run registry dismiss failed:', update.error.message);
      }),
    );
  } catch (err) {
    console.error('[agent3] run registry dismiss failed:', errorText(err));
  }
}

/** Sólo para pruebas: que el próximo barrido corra aunque haya pasado menos de un minuto. */
export function resetFirstContactSweepForTests(): void {
  lastSweepAtMs = 0;
}
