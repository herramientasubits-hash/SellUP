#!/usr/bin/env tsx
/**
 * certification-baseline-replay.ts — la línea base de certificación de UNA
 * corrida ya almacenada, reconstruida SIN volver a pagarle a nadie.
 *
 * A1-CERTIFICATION-READINESS § CUT-E.2.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * `src/modules/provider-certification/*` y `replayApolloRunAcceptance` eran
 * correctos y puros, y no los llamaba nadie fuera de sus pruebas. Una línea base
 * que sólo existe como biblioteca no es una capacidad: es una promesa. Éste es
 * el consumidor mínimo que la vuelve operable.
 *
 * ── 🔴 Qué hace y qué NO ────────────────────────────────────────────────────
 *
 * LEE cuatro tablas y ESCRIBE en la salida estándar. Nada más.
 *
 *   0 llamadas a proveedor  · no importa ningún cliente de Apollo/Lusha/Tavily
 *   0 créditos              · no reserva, no liquida, no toca presupuesto
 *   0 escrituras            · ni INSERT, ni UPDATE, ni UPSERT, ni DELETE
 *   0 migraciones           · no toca esquema
 *
 * Las tres primeras las vigila una guarda estática de la suite de CUT-E sobre
 * ESTE fichero, no un comentario.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   npm run cert:baseline -- --wizard-run-id=294298cdd4fa9c37baf9a33543cb1355
 *
 * Salida: un JSON con una fila de línea base por proveedor que participó, su
 * desglose de gasto por operación cobrada y sus diagnósticos.
 */

import { createClient } from '@supabase/supabase-js';
import {
  buildApolloRunCertificationBaseline,
  buildLushaRunCertificationBaseline,
} from '../../src/modules/provider-certification/run-baseline';
import {
  computeCertificationMetrics,
  type CertificationBaselineRow,
} from '../../src/modules/provider-certification/certification-baseline';
import {
  deriveProviderOrder,
  type ProviderUsageLogLike,
} from '../../src/modules/provider-certification/usage-log-adapters';
import type { StoredCandidateRow } from '../../src/server/agents/prospecting-toolkit/apollo-accepted-for-target-replay';

function readOnlyClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('[cert-baseline] credenciales no configuradas');
  return createClient(url, key);
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() || null : null;
}

function countBy(values: readonly (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const key = value ?? 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

type ProviderReport = {
  provider: string;
  row: CertificationBaselineRow;
  metrics: ReturnType<typeof computeCertificationMetrics>;
  credits: unknown;
  diagnostics: readonly string[];
};

async function main() {
  const wizardRunId = argValue('wizard-run-id');
  if (!wizardRunId) {
    console.error('Falta --wizard-run-id=<id>');
    process.exit(2);
    return;
  }

  const db = readOnlyClient();

  // ── 1 · filas de gasto de la corrida ──────────────────────────────────────
  const usage = await db
    .from('provider_usage_logs')
    .select(
      'provider_key,operation_key,credits_used,results_returned,duration_ms,wizard_run_id,request_fingerprint,batch_id,created_at,metadata',
    )
    .eq('wizard_run_id', wizardRunId)
    .order('created_at', { ascending: true });
  if (usage.error) throw new Error(`[cert-baseline] usage: ${usage.error.message}`);

  const usageRows = (usage.data ?? []) as unknown as ProviderUsageLogLike[];
  if (usageRows.length === 0) {
    console.error(`[cert-baseline] la corrida ${wizardRunId} no tiene filas de gasto`);
    process.exit(1);
    return;
  }

  const batchId = usageRows.map((r) => r.batch_id).find((b): b is string => Boolean(b)) ?? null;

  // ── 2 · candidatos del lote, con su proveedor y su veredicto durable ──────
  let candidateRows: (StoredCandidateRow & { source_provider: string | null })[] = [];
  if (batchId) {
    const candidates = await db
      .from('prospect_candidates')
      .select('id,source_trace,metadata')
      .eq('batch_id', batchId);
    if (candidates.error) throw new Error(`[cert-baseline] candidates: ${candidates.error.message}`);
    candidateRows = (candidates.data ?? []).map((c) => {
      const row = c as { id: string; source_trace: unknown; metadata: unknown };
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        source_trace: (row.source_trace ?? null) as Record<string, unknown> | null,
        source_provider: typeof meta.source_provider === 'string' ? meta.source_provider : null,
      };
    });
  }

  // ── 3 · la aceptación de PAGO que el lote publica — sólo para CONTRASTAR ──
  let batchAcceptedPaidForTarget: number | null = null;
  if (batchId) {
    const batch = await db.from('prospect_batches').select('metadata').eq('id', batchId).single();
    if (batch.error) throw new Error(`[cert-baseline] batch: ${batch.error.message}`);
    const meta = ((batch.data as { metadata?: unknown } | null)?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    const block = (meta.accepted_for_target ?? null) as Record<string, unknown> | null;
    const value = block?.accepted_paid_for_target;
    batchAcceptedPaidForTarget = typeof value === 'number' ? value : null;
  }

  // ── 4 · disposiciones durables del lote, por proveedor ────────────────────
  const dispositionsByProvider: Record<string, Record<string, number>> = {};
  if (batchId) {
    const discards = await db
      .from('prospect_discarded_dispositions')
      .select('source_primary,disposition')
      .eq('batch_id', batchId);
    if (discards.error) throw new Error(`[cert-baseline] discards: ${discards.error.message}`);
    for (const raw of discards.data ?? []) {
      const row = raw as { source_primary: string | null; disposition: string | null };
      const provider = row.source_primary ?? 'unknown';
      dispositionsByProvider[provider] = dispositionsByProvider[provider] ?? {};
      const code = row.disposition ?? 'unknown';
      dispositionsByProvider[provider][code] = (dispositionsByProvider[provider][code] ?? 0) + 1;
    }
  }

  // ── 5 · proyección ────────────────────────────────────────────────────────
  const providerKeysInBatch = [...new Set(usageRows.map((r) => r.provider_key))];
  const order = deriveProviderOrder(usageRows);
  const reports: ProviderReport[] = [];

  const apolloRows = usageRows.filter((r) => r.provider_key === 'apollo');
  if (apolloRows.length > 0) {
    const apollo = buildApolloRunCertificationBaseline({
      usageRows: apolloRows,
      candidateRows: candidateRows.filter((c) => c.source_provider === 'apollo'),
      batchAcceptedPaidForTarget,
      providerKeysInBatch,
      dispositions: dispositionsByProvider.apollo ?? null,
      providerOrder: order.get(apolloRows[0]) ?? null,
    });
    reports.push({
      provider: 'apollo',
      row: apollo.row,
      metrics: computeCertificationMetrics(apollo.row),
      credits: apollo.credits,
      diagnostics: apollo.diagnostics,
    });
  }

  const lushaRows = usageRows.filter((r) => r.provider_key === 'lusha');
  if (lushaRows.length > 0) {
    const lusha = buildLushaRunCertificationBaseline({
      usageRows: lushaRows,
      dispositions: dispositionsByProvider.lusha ?? null,
      providerOrder: order.get(lushaRows[0]) ?? null,
    });
    reports.push({
      provider: 'lusha',
      row: lusha.row,
      metrics: computeCertificationMetrics(lusha.row),
      credits: lusha.credits,
      diagnostics: lusha.diagnostics,
    });
  }

  console.log(
    JSON.stringify(
      {
        wizard_run_id: wizardRunId,
        batch_id: batchId,
        provider_keys_in_batch: providerKeysInBatch,
        candidates_by_provider: countBy(candidateRows.map((c) => c.source_provider)),
        batch_accepted_paid_for_target: batchAcceptedPaidForTarget,
        providers: reports,
        provider_calls: 0,
        credits_spent: 0,
        writes: 0,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error('[cert-baseline]', err instanceof Error ? err.message : err);
  process.exit(1);
});
