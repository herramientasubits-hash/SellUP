#!/usr/bin/env tsx
/**
 * Controlled Post-Approval NIT Enrichment Runner — Agent 1 v1.16K-P
 *
 * Ejecuta runPostApprovalNitEnrichmentWorker para UN ÚNICO candidato, de forma
 * manual y controlada. NO es un cron. NO procesa la cola completa.
 *
 * Garantías:
 *   - Requiere --candidate-id explícito; aborta si falta.
 *   - Usa SUPABASE_SERVICE_ROLE_KEY (service role).
 *   - Preflight read-only SIEMPRE; aborta si el candidato no está en estado
 *     'queued' / 'nit_first' con NIT válido.
 *   - El worker recibe { candidateId } → solo ese candidato se escribe, aunque
 *     selectQueuedCandidates lea otros (read-only) para el prefetch.
 *   - Sin --execute, solo corre el preflight (no escribe nada).
 *   - Imprime únicamente un resumen; nunca secretos.
 *   - Usa el ENRICHMENT_ADAPTER_REGISTRY real → llamadas Socrata live para las
 *     fuentes CO configuradas. NO Tavily / NO LLM / NO LinkedIn.
 *
 * Uso:
 *   node --env-file=.env.local --import tsx \
 *     scripts/agent1/run-post-approval-enrichment-for-candidate.ts \
 *     --candidate-id=<uuid> [--execute]
 */

import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

// Node 20 ships no global WebSocket; the worker transitively constructs a
// Supabase realtime client. Install the CLI-only shim before that import runs.
ensureNode20WebSocketShim();

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  runPostApprovalNitEnrichmentWorker,
  CO_NIT_SAFE_SOURCE_KEYS,
} from '../../src/server/prospect-batches/post-approval-nit-enrichment-worker';

// ── Args ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { candidateId: string | null; execute: boolean } {
  let candidateId: string | null = null;
  let execute = false;
  for (const arg of argv) {
    if (arg.startsWith('--candidate-id=')) candidateId = arg.split('=')[1]?.trim() || null;
    else if (arg === '--execute') execute = true;
  }
  return { candidateId, execute };
}

// ── Supabase admin ────────────────────────────────────────────────────────────

function getSupabase(): SupabaseClient {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not set — cannot run controlled runner');
  }
  return createClient(url, key);
}

// ── Preflight (read-only) ──────────────────────────────────────────────────────

interface PreflightResult {
  ok: boolean;
  reasons: string[];
  candidate: Record<string, unknown> | null;
  pae: Record<string, unknown> | null;
}

async function preflight(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<PreflightResult> {
  const reasons: string[] = [];

  const { data, error } = await supabase
    .from('prospect_candidates')
    .select(
      'id, name, status, converted_account_id, tax_identifier, tax_identifier_type, country_code, metadata',
    )
    .eq('id', candidateId)
    .maybeSingle();

  if (error) {
    reasons.push(`query_error: ${error.message}`);
    return { ok: false, reasons, candidate: null, pae: null };
  }
  if (!data) {
    reasons.push('candidate_not_found');
    return { ok: false, reasons, candidate: null, pae: null };
  }

  const meta = (data.metadata as Record<string, unknown> | null) ?? {};
  const pae = (meta.post_approval_enrichment as Record<string, unknown> | undefined) ?? null;

  if (data.status !== 'converted_to_account') reasons.push(`status_not_converted (${data.status})`);
  if (!data.converted_account_id) reasons.push('converted_account_id_missing');
  if (!pae) reasons.push('post_approval_enrichment_missing');
  else {
    if (pae.status !== 'queued') reasons.push(`pae.status_not_queued (${String(pae.status)})`);
    if (pae.strategy !== 'nit_first') reasons.push(`pae.strategy_not_nit_first (${String(pae.strategy)})`);
    if (typeof pae.nit !== 'string' || !(pae.nit as string).trim()) reasons.push('pae.nit_missing');
    const keys = Array.isArray(pae.source_keys) ? (pae.source_keys as string[]) : [];
    const outOfScope = keys.filter((k) => !CO_NIT_SAFE_SOURCE_KEYS.includes(k));
    if (outOfScope.length > 0) reasons.push(`pae.source_keys_out_of_scope (${outOfScope.join(',')})`);
  }

  return { ok: reasons.length === 0, reasons, candidate: data as Record<string, unknown>, pae };
}

// ── Account duplicate check (read-only) ─────────────────────────────────────────

async function countAccountsForCandidate(
  supabase: SupabaseClient,
  accountId: string | null,
  taxId: string | null,
  countryCode: string | null,
): Promise<{ byId: number; byTaxId: number }> {
  let byId = 0;
  let byTaxId = 0;
  if (accountId) {
    const { count } = await supabase
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('id', accountId);
    byId = count ?? 0;
  }
  if (taxId) {
    const query = supabase
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('tax_identifier', taxId);
    if (countryCode) query.eq('country_code', countryCode);
    const { count } = await query;
    byTaxId = count ?? 0;
  }
  return { byId, byTaxId };
}

// ── Other queued candidates snapshot (read-only) ───────────────────────────────

async function snapshotOtherQueued(
  supabase: SupabaseClient,
  excludeId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('prospect_candidates')
    .select('id, metadata')
    .eq('status', 'converted_to_account')
    .not('converted_account_id', 'is', null)
    .limit(60);

  const rows = (data ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>;
  return rows
    .filter((r) => {
      const pae = (r.metadata?.post_approval_enrichment as Record<string, unknown> | undefined) ?? null;
      return pae?.status === 'queued' && pae?.strategy === 'nit_first' && r.id !== excludeId;
    })
    .map((r) => r.id);
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const { candidateId, execute } = parseArgs(process.argv.slice(2));

  console.log('\n' + '═'.repeat(72));
  console.log('CONTROLLED POST-APPROVAL NIT ENRICHMENT RUNNER — Agent 1 v1.16K-P');
  console.log('═'.repeat(72) + '\n');

  if (!candidateId) {
    console.error('✗ ABORT: --candidate-id=<uuid> es obligatorio.');
    console.error('  Uso: ... run-post-approval-enrichment-for-candidate.ts --candidate-id=<uuid> [--execute]');
    process.exit(1);
  }

  console.log(`  candidateId : ${candidateId}`);
  console.log(`  mode        : ${execute ? 'EXECUTE (worker will run + write)' : 'PREFLIGHT ONLY (read-only)'}\n`);

  const supabase = getSupabase();

  // ── PREFLIGHT ────────────────────────────────────────────────────────────
  console.log('── PREFLIGHT (read-only) ──────────────────────────────────────────\n');
  const pre = await preflight(supabase, candidateId);

  if (pre.candidate) {
    const c = pre.candidate;
    console.log(`  name                 : ${c.name}`);
    console.log(`  status               : ${c.status}`);
    console.log(`  converted_account_id : ${c.converted_account_id}`);
    console.log(`  country_code         : ${c.country_code}`);
    console.log(`  tax_identifier       : ${c.tax_identifier} (${c.tax_identifier_type})`);
    console.log(`  pae.status           : ${pre.pae?.status ?? 'MISSING'}`);
    console.log(`  pae.strategy         : ${pre.pae?.strategy ?? 'MISSING'}`);
    console.log(`  pae.nit              : ${pre.pae?.nit ?? 'MISSING'}`);
    const keys = Array.isArray(pre.pae?.source_keys) ? (pre.pae?.source_keys as string[]) : [];
    console.log(`  pae.source_keys      : ${keys.join(', ') || 'NONE'}`);
  }

  const dupBefore = await countAccountsForCandidate(
    supabase,
    (pre.candidate?.converted_account_id as string | null) ?? null,
    (pre.candidate?.tax_identifier as string | null) ?? null,
    (pre.candidate?.country_code as string | null) ?? null,
  );
  console.log(`\n  accounts by id       : ${dupBefore.byId}`);
  console.log(`  accounts by tax_id   : ${dupBefore.byTaxId}`);

  const otherQueuedBefore = await snapshotOtherQueued(supabase, candidateId);
  console.log(`  other queued (excl.) : ${otherQueuedBefore.length}${otherQueuedBefore.length ? ' → ' + otherQueuedBefore.join(', ') : ''}`);

  if (!pre.ok) {
    console.error(`\n✗ PREFLIGHT FAILED: ${pre.reasons.join('; ')}`);
    console.error('  No se ejecuta el worker. Revisar estado del candidato.');
    process.exit(1);
  }
  console.log('\n  ✓ Preflight OK.');

  if (!execute) {
    console.log('\n── PREFLIGHT-ONLY mode — no se ejecuta el worker. Pasa --execute para correr. ──\n');
    return;
  }

  // ── EXECUTE ──────────────────────────────────────────────────────────────
  console.log('\n── EXECUTE WORKER (live CO Socrata adapters, candidateId-limited) ──\n');
  console.log('  registry      : ENRICHMENT_ADAPTER_REGISTRY (real)');
  console.log('  maxCandidates : 5 (prefetch read-only; write filtered to candidateId)\n');

  const stats = await runPostApprovalNitEnrichmentWorker({
    supabase,
    candidateId,
    maxCandidates: 5,
  });

  console.log('  Worker stats:', JSON.stringify(stats, null, 2));

  // ── POSTFLIGHT (read-only) ────────────────────────────────────────────────
  console.log('\n── POSTFLIGHT (read-only) ─────────────────────────────────────────\n');

  const { data: afterRow } = await supabase
    .from('prospect_candidates')
    .select('metadata')
    .eq('id', candidateId)
    .maybeSingle();

  const metaAfter = (afterRow?.metadata as Record<string, unknown>) ?? {};
  const paeAfter = (metaAfter.post_approval_enrichment as Record<string, unknown>) ?? {};
  const seAfter = (metaAfter.source_enrichment as Record<string, unknown>) ?? {};

  console.log('  post_approval_enrichment:');
  console.log(JSON.stringify(paeAfter, null, 2));

  console.log('\n  source_enrichment (status por fuente):');
  for (const [k, v] of Object.entries(seAfter)) {
    const block = (v as Record<string, unknown>) ?? {};
    console.log(`    ${k}: status=${block.status ?? 'n/a'} matched_by=${block.matched_by ?? 'n/a'} confidence=${block.confidence ?? 'n/a'}`);
  }
  console.log(`\n  source_enrichment._summary present: ${Object.prototype.hasOwnProperty.call(seAfter, '_summary')}`);

  // Audit
  const { data: auditRows } = await supabase
    .from('prospect_candidate_audit')
    .select('action_type, details, created_at')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(3);

  console.log(`\n  Audit rows (latest ${(auditRows ?? []).length}):`);
  for (const row of (auditRows ?? []) as Array<Record<string, unknown>>) {
    const details = (row.details as Record<string, unknown>) ?? {};
    console.log(`    → ${row.action_type} / ${details.sub_action ?? 'n/a'} @ ${row.created_at}`);
  }

  // Dup + other queued after
  const dupAfter = await countAccountsForCandidate(
    supabase,
    (pre.candidate?.converted_account_id as string | null) ?? null,
    (pre.candidate?.tax_identifier as string | null) ?? null,
    (pre.candidate?.country_code as string | null) ?? null,
  );
  const otherQueuedAfter = await snapshotOtherQueued(supabase, candidateId);

  console.log(`\n  accounts by id (after)     : ${dupAfter.byId} (before ${dupBefore.byId})`);
  console.log(`  accounts by tax_id (after) : ${dupAfter.byTaxId} (before ${dupBefore.byTaxId})`);
  console.log(`  other queued (after)       : ${otherQueuedAfter.length} (before ${otherQueuedBefore.length})`);

  const otherUntouched =
    otherQueuedAfter.length === otherQueuedBefore.length &&
    otherQueuedBefore.every((id) => otherQueuedAfter.includes(id));

  console.log('\n' + '═'.repeat(72));
  console.log('VEREDICTO');
  console.log('═'.repeat(72));
  console.log(`  worker processed       : ${stats.processed} (queued_found=${stats.queued_found})`);
  console.log(`  final pae.status       : ${paeAfter.status ?? 'n/a'}`);
  console.log(`  account NOT duplicated : ${dupAfter.byId === 1 ? 'YES (=1)' : 'NO (=' + dupAfter.byId + ')'}`);
  console.log(`  other queued untouched : ${otherUntouched ? 'YES' : 'NO'}`);
  console.log('═'.repeat(72) + '\n');
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
