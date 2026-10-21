/**
 * apollo-saved-contact-phones.mts — teléfonos YA GUARDADOS en Apollo para personas sin
 * teléfono en SellUp (APOLLO-SAVED-CONTACT-PHONES-1, 21-10-2026).
 *
 * Apollo no vuelve a cobrar un teléfono que el equipo ya guardó como Contact, y
 * `POST /api/v1/contacts/search` busca en esos contactos con 0 créditos. La decisión por
 * persona (identidad estricta, no contactar, «no llamar», tombstones) vive en el núcleo
 * puro `src/modules/contact-enrichment/apollo-saved-contact-phone-import-core.ts`.
 *
 * Modos:
 *   --plan     SÓLO LECTURA. Lee SellUp (Supabase) y consulta contacts/search de Apollo.
 *              No escribe en ningún sitio salvo el informe local `--out`. El informe
 *              NUNCA lleva números completos (sólo los 2 últimos dígitos) ni la API key.
 *   --execute  ESCRIBE en SellUp. Exige `--confirm APOLLO-SAVED-CONTACT-PHONES-1` y que la
 *              migración 155 esté aplicada. Recalcula el plan con datos frescos y escribe
 *              objetivo por objetivo con las funciones de la 155; se detiene en el primer
 *              resultado inesperado. Re-ejecutar es idempotente. Ver el .md junto a este archivo.
 *
 * Uso:
 *   /usr/local/bin/node --env-file=/Users/ub-col-pro-lf4/Documents/SellUp/.env.local --import tsx \
 *     scripts/ops/apollo-saved-contact-phones.mts --plan --out <informe.json>
 *     | --execute --confirm APOLLO-SAVED-CONTACT-PHONES-1 --out <informe.json>
 */

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  SAVED_CONTACT_PHONE_PROCESSING_BASIS,
  buildSavedContactImportPayload,
  decideSavedContactPhoneImport,
  maskPhoneForReport,
  matchApolloSavedContact,
  resolveSavedContactSuppressionPersonId,
  type ApolloSavedContact,
  type SavedContactImportDecision,
  type SavedContactImportTarget,
  type SavedContactSuppressionResult,
} from '@/modules/contact-enrichment/apollo-saved-contact-phone-import-core';
import {
  evaluatePhoneRevealSuppression,
  resolvePhoneRevealProviderIdentity,
} from '@/modules/contact-enrichment/provider-suppression-core';
import { readPhoneRevealSuppression } from '@/modules/contact-enrichment/provider-suppression-store';

const APOLLO_VAULT_SECRET_NAME = 'sellup_prospecting_apollo_api_key';
const CONTACTS_SEARCH_URL = 'https://api.apollo.io/api/v1/contacts/search';
const PAUSE_MS = 350;
const MAX_RETRIES = 3;

const CONFIRM = 'APOLLO-SAVED-CONTACT-PHONES-1';
const args = process.argv.slice(2);
const mode = args.includes('--execute') ? 'execute' : args.includes('--plan') ? 'plan' : null;
if (!mode) {
  console.error(`Uso: --plan --out <informe.json> | --execute --confirm ${CONFIRM} --out <informe.json>`);
  process.exit(1);
}
if (mode === 'execute' && args[args.indexOf('--confirm') + 1] !== CONFIRM) {
  console.error(`--execute exige --confirm ${CONFIRM}`);
  process.exit(1);
}
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
if (!outPath) {
  console.error('Falta --out <ruta-informe.json>');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Faltan credenciales de Supabase');
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: apolloKey, error: keyError } = await admin.rpc('get_vault_secret_decrypted', {
  p_name: APOLLO_VAULT_SECRET_NAME,
});
if (keyError || typeof apolloKey !== 'string' || apolloKey.length < 10) {
  throw new Error('No se pudo leer la clave de Apollo del Vault');
}

// ── Objetivos ──────────────────────────────────────────────────

interface Target extends SavedContactImportTarget {
  fullName: string | null;
}

async function loadCandidateTargets(): Promise<Target[]> {
  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select('id, full_name, email, linkedin_url, source, source_contact_id, apollo_person_id, enrichment_run_id')
    .eq('source', 'apollo')
    .is('phone', null)
    .in('status', ['pending_review', 'approved']);
  if (error) throw new Error(`candidatos: ${error.message}`);
  const rows = data ?? [];

  const runIds = [...new Set(rows.map((row) => row.enrichment_run_id).filter(Boolean))];
  const accountByRun = new Map<string, string | null>();
  if (runIds.length > 0) {
    const { data: runs, error: runsError } = await admin
      .from('contact_enrichment_runs')
      .select('id, account_id')
      .in('id', runIds);
    if (runsError) throw new Error(`corridas: ${runsError.message}`);
    for (const run of runs ?? []) accountByRun.set(run.id, run.account_id ?? null);
  }

  return rows.map((row) => ({
    kind: 'candidate' as const,
    id: row.id,
    fullName: row.full_name ?? null,
    accountId: row.enrichment_run_id ? (accountByRun.get(row.enrichment_run_id) ?? null) : null,
    apolloPersonId:
      resolvePhoneRevealProviderIdentity({
        apolloPersonId: row.apollo_person_id,
        source: row.source,
        sourceContactId: row.source_contact_id,
      })?.providerPersonId ?? null,
    email: row.email ?? null,
    linkedinUrl: row.linkedin_url ?? null,
  }));
}

async function loadContactTargets(): Promise<Target[]> {
  const { data, error } = await admin
    .from('contacts')
    .select('id, full_name, email, linkedin_url, account_id')
    .eq('source', 'apollo')
    .is('phone', null)
    .is('mobile_phone', null)
    .is('archived_at', null);
  if (error) throw new Error(`contactos: ${error.message}`);
  return (data ?? []).map((row) => ({
    kind: 'contact' as const,
    id: row.id,
    fullName: row.full_name ?? null,
    accountId: row.account_id ?? null,
    apolloPersonId: null,
    email: row.email ?? null,
    linkedinUrl: row.linkedin_url ?? null,
  }));
}

/** Dedupe keys suprimidas (tombstones DSAR) por objetivo. */
async function loadTombstones(table: string, ownerColumn: string, ids: string[]): Promise<Map<string, Set<string>>> {
  const byOwner = new Map<string, Set<string>>();
  if (ids.length === 0) return byOwner;
  const { data, error } = await admin
    .from(table)
    .select(`${ownerColumn}, dedupe_key`)
    .in(ownerColumn, ids)
    .not('suppressed_at', 'is', null);
  if (error) throw new Error(`${table}: ${error.message}`);
  for (const row of (data ?? []) as unknown as Record<string, string>[]) {
    const owner = row[ownerColumn];
    if (!byOwner.has(owner)) byOwner.set(owner, new Set());
    byOwner.get(owner)!.add(row.dedupe_key);
  }
  return byOwner;
}

// ── Apollo ─────────────────────────────────────────────────────

let apolloCalls = 0;
let apolloErrors = 0;
const creditHeaders = new Set<string>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function searchSavedContacts(query: string): Promise<ApolloSavedContact[]> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    apolloCalls += 1;
    const response = await fetch(CONTACTS_SEARCH_URL, {
      method: 'POST',
      headers: { 'X-Api-Key': apolloKey as string, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({ q_keywords: query, page: 1, per_page: 10 }),
    });
    const credits = response.headers.get('x-credits-used') ?? response.headers.get('x-apollo-credits-used');
    if (credits) creditHeaders.add(credits);
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Apollo contacts/search sin permiso (${response.status})`);
    }
    if (response.status === 429 || response.status >= 500) {
      apolloErrors += 1;
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      apolloErrors += 1;
      return [];
    }
    const body = (await response.json()) as { contacts?: ApolloSavedContact[] };
    await sleep(PAUSE_MS);
    return Array.isArray(body.contacts) ? body.contacts : [];
  }
  return [];
}

/** Correo primero (más preciso), luego nombre. La coincidencia final nunca es por nombre. */
async function findSavedContact(target: Target) {
  const queries = [target.email, target.fullName].filter((value): value is string => !!value?.trim());
  for (const query of queries) {
    const match = matchApolloSavedContact(target, await searchSavedContacts(query));
    if (match.kind !== 'none') return match;
  }
  return { kind: 'none' as const };
}

// ── Plan ───────────────────────────────────────────────────────

const candidates = await loadCandidateTargets();
const contacts = await loadContactTargets();
const tombstones = new Map([
  ...(await loadTombstones('contact_enrichment_candidate_phones', 'candidate_id', candidates.map((t) => t.id))),
  ...(await loadTombstones('contact_phones', 'contact_id', contacts.map((t) => t.id))),
]);
const targets: Target[] = [...candidates, ...contacts];
console.log(`Objetivos: ${targets.length} (${candidates.length} candidatos, ${contacts.length} contactos oficiales)`);

const decisions: SavedContactImportDecision[] = [];
const dncValues = new Map<string, number>();
for (const target of targets) {
  const match = await findSavedContact(target);
  let suppression: SavedContactSuppressionResult = { kind: 'not_evaluable' };
  if (match.kind === 'matched') {
    const personId = resolveSavedContactSuppressionPersonId(target, match);
    suppression = await evaluatePhoneRevealSuppression({
      identity: personId ? { provider: 'apollo', providerPersonId: personId } : null,
      accountId: target.accountId,
      lookup: readPhoneRevealSuppression,
      redactError: () => 'suppression lookup failed',
    });
    for (const entry of Array.isArray(match.contact.phone_numbers) ? match.contact.phone_numbers : []) {
      const raw = entry && typeof entry.dnc_status === 'string' ? entry.dnc_status : '(vacío)';
      dncValues.set(raw, (dncValues.get(raw) ?? 0) + 1);
    }
  }
  decisions.push(
    decideSavedContactPhoneImport({
      target,
      match,
      suppression,
      tombstonedDedupeKeys: tombstones.get(target.id) ?? new Set(),
    }),
  );
}

const count = (predicate: (d: SavedContactImportDecision) => boolean) => decisions.filter(predicate).length;
const byDecision = decisions.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.decision]: (acc[d.decision] ?? 0) + 1 }), {});
const importable = decisions.filter((d) => d.decision === 'would_import');

const summary = {
  mode: mode === 'plan' ? 'plan (sin escritura)' : 'execute (plan recalculado antes de escribir)',
  targets: targets.length,
  candidates: candidates.length,
  contacts: contacts.length,
  apollo_calls: apolloCalls,
  apollo_errors: apolloErrors,
  credit_headers_seen: [...creditHeaders],
  would_import: importable.length,
  would_import_candidates: count((d) => d.decision === 'would_import' && d.targetKind === 'candidate'),
  would_import_contacts: count((d) => d.decision === 'would_import' && d.targetKind === 'contact'),
  phones_to_write: importable.reduce((total, d) => total + (d.decision === 'would_import' ? d.phones.length : 0), 0),
  by_decision: byDecision,
  match_by: decisions.reduce<Record<string, number>>((acc, d) => (d.matchedBy ? { ...acc, [d.matchedBy]: (acc[d.matchedBy] ?? 0) + 1 } : acc), {}),
  apollo_dnc_status_values: Object.fromEntries(dncValues),
};

const report = {
  summary,
  rows: decisions.map((d) => ({
    target_kind: d.targetKind,
    target_id: d.targetId,
    decision: d.decision,
    matched_by: d.matchedBy,
    has_apollo_person_id: !!d.apolloPersonId,
    ...(d.decision === 'would_import'
      ? {
          phones: d.phones.map((phone) => ({
            masked: maskPhoneForReport(phone.displayPhone),
            type: phone.phoneType,
            status: phone.phoneStatus,
            primary: phone.dedupeKey === d.primaryDedupeKey,
          })),
          dropped_do_not_call: d.droppedDoNotCall,
          dropped_tombstoned: d.droppedTombstoned,
        }
      : {}),
  })),
};

// ── Escritura (sólo con --execute --confirm) ───────────────────
// El plan de arriba se acaba de recalcular con datos frescos. Cada objetivo se escribe en
// su propia transacción (funciones de la migración 155), que vuelve a bloquear la fila,
// re-chequea la supresión, respeta tombstones y NUNCA pisa un teléfono existente.

const WRITERS = {
  candidate: 'import_candidate_apollo_saved_phones',
  contact: 'import_contact_apollo_saved_phones',
} as const;
/** Resultados que no son error: el objetivo cambió desde el plan y la función se negó con razón. */
const BENIGN_STATUSES = new Set(['persisted', 'persisted_without_primary', 'target_has_phone', 'suppressed']);

const executed: Array<{ target_kind: string; target_id: string; status: string; detail?: string }> = [];
if (mode === 'execute') {
  const observedAt = new Date().toISOString();
  for (const decision of importable) {
    if (decision.decision !== 'would_import') continue;
    const payload = buildSavedContactImportPayload(decision);
    const params = {
      ...(decision.targetKind === 'candidate' ? { p_candidate_id: decision.targetId } : { p_contact_id: decision.targetId }),
      p_apollo_person_id: decision.apolloPersonId,
      p_observed_at: observedAt,
      p_phones: payload.phones,
      p_sources: payload.sources,
      p_primary_candidates: payload.primaryCandidates,
      p_processing_basis: SAVED_CONTACT_PHONE_PROCESSING_BASIS,
    };
    const { data, error } = await admin.rpc(WRITERS[decision.targetKind], params);
    const status = error ? 'rpc_error' : String((data as { status?: unknown } | null)?.status ?? 'unknown');
    const detail = error ? error.code ?? 'error' : (data as { detail?: string } | null)?.detail;
    executed.push({ target_kind: decision.targetKind, target_id: decision.targetId, status, ...(detail ? { detail } : {}) });
    if (!BENIGN_STATUSES.has(status)) {
      console.error(`Detenido en ${decision.targetKind} ${decision.targetId}: ${status}${detail ? ` (${detail})` : ''}`);
      break;
    }
  }
}

const executionSummary =
  mode === 'execute'
    ? executed.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {})
    : null;

writeFileSync(
  outPath,
  JSON.stringify({ ...report, ...(mode === 'execute' ? { executed, execution_summary: executionSummary } : {}) }, null, 2),
);
console.log(JSON.stringify({ ...summary, ...(executionSummary ? { execution_summary: executionSummary } : {}) }, null, 2));
console.log(`Informe (sin números completos): ${outPath}`);
if (mode === 'execute' && executed.some((row) => !BENIGN_STATUSES.has(row.status))) process.exit(1);
