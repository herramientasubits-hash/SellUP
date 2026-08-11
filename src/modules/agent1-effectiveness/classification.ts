// Q3F-5AY.2 — Record Origin Derivation Classifier (pure, Phase 1).
//
// Derives `record_origin`, `rejection_reason` and `classification_source` for
// Agent 1 candidates (`prospect_candidates`) from candidate + optional batch
// (`prospect_batches`) evidence. Based on the approved design Q3F-5AY.1.
//
// STRICTLY PURE:
//   - No DB. No fetch. No provider calls. No Supabase import. No env.
//   - Never mutates its inputs.
//   - Never throws on null/undefined/partial data.
//
// Marker semantics are aligned with the existing, canonical detector
// `isQaOrSmokeCandidateForNegativeMemory` in
// src/server/agents/prospecting-toolkit/novelty-checker.ts so the two agree on
// what counts as a smoke/QA/cleanup record.
//
// AGENT1-RECORD-ORIGIN-CLASSIFIER-HARDENING-1 — contrato del clasificador:
//
//   * Es un clasificador PURO. Sin DB, sin reloj, sin env, sin provider.
//   * La EVIDENCIA EXPLÍCITA DE NO-PRODUCCIÓN GANA SIEMPRE sobre cualquier
//     inferencia de producción por status. Un `status` legítimo, por sí solo,
//     nunca puede sobreponerse a un marcador que declara que la ejecución no
//     ocurrió, no estaba autorizada, o era QA/smoke/fixture/seed/cleanup/import.
//   * `review_notes` puede aportar el MOTIVO de un rechazo, pero nunca es
//     evidencia suficiente, por sí sola, para afirmar `production`.
//   * NO es autoridad suficiente para ejecutar backfills históricos: remediar
//     filas existentes exige procedencia auditada externa a esta función.

// ─────────────────────────────────────────────────────────────────────────────
// Taxonomies (Q3F-5AY.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where the record actually came from. `synthetic` is reserved for a real
 * non-smoke synthetic path; today all synthetic SMOKE data folds into
 * `smoke_test` (see `synthetic_folded_into_smoke_test` warning).
 */
export type RecordOrigin =
  | 'production'
  | 'smoke_test'
  | 'qa'
  | 'historical_cleanup'
  | 'import'
  | 'unknown'
  | 'synthetic';

/**
 * Why a candidate was rejected/discarded/duplicated. Null unless the record is
 * discarded/duplicate. Mechanical values are safe to derive; the reserved
 * human-only commercial values must NOT be derived aggressively — only on an
 * explicit signal (see `outside_icp`).
 */
export type RejectionReason =
  // Mechanical (safe to derive):
  | 'test_record'
  | 'cleanup_record'
  | 'duplicate'
  | 'unknown'
  // Reserved / human-only (not derived aggressively):
  | 'outside_icp'
  | 'existing_account'
  | 'insufficient_data'
  | 'invalid_company'
  | 'provider_noise'
  | 'marketplace_or_directory'
  | 'geographic_mismatch'
  | 'industry_mismatch'
  | 'do_not_use'
  | 'no_longer_relevant'
  | 'other';

/** Which piece of evidence drove the classification. */
export type ClassificationSource =
  | 'writer'
  | 'derived_metadata'
  | 'derived_source_primary'
  | 'derived_review_notes'
  | 'derived_batch'
  | 'manual'
  | 'derived_status'
  | 'unknown';

/** The first rule (top-down) that matched. */
export type MatchedRule =
  | 'smoke_marker'
  | 'qa_marker'
  | 'synthetic_marker'
  | 'historical_cleanup_note'
  | 'external_import'
  | 'unexecuted_or_unauthorized'
  | 'duplicate_status'
  | 'outside_icp_note'
  | 'production_status'
  | 'discarded_unknown'
  | 'fallback_unknown';

/** Non-fatal caveats surfaced alongside a classification. */
export type ClassificationWarning =
  | 'ambiguous_review_note'
  | 'commercial_reason_low_confidence'
  | 'unknown_discarded_reason'
  | 'batch_origin_used'
  | 'synthetic_folded_into_smoke_test'
  // HARDENING-1: la ejecución se declara explícitamente no ocurrida / no autorizada.
  | 'explicit_nonproduction_marker'
  // HARDENING-1: hay motivo comercial, pero NADA que pruebe una corrida real.
  | 'production_evidence_insufficient'
  // HARDENING-1: se observó una pista débil (`do_not_sync_hubspot`,
  // `runner_required`) que NO decide por sí sola. Se declara en vez de callarla.
  | 'nonproduction_hint_not_decisive';

export interface RecordOriginClassification {
  recordOrigin: RecordOrigin;
  rejectionReason: RejectionReason | null;
  classificationSource: ClassificationSource;
  /** 0–100 confidence in the derivation. Explicit fields score highest. */
  classificationConfidence: number;
  matchedRule: MatchedRule;
  warnings: ClassificationWarning[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs (shaped after the real DB columns; snake_case on purpose)
// ─────────────────────────────────────────────────────────────────────────────

/** Candidate-like input. All fields optional/nullable; never mutated. */
export interface ClassifiableCandidate {
  id?: string | null;
  status?: string | null;
  duplicate_status?: string | null;
  source_primary?: string | null;
  review_notes?: string | null;
  metadata?: Record<string, unknown> | null;
  review_flags?: Record<string, unknown> | null;
  reviewed_by?: string | null;
}

/** Batch-like input. Used only as a fallback origin signal. */
export interface ClassifiableBatch {
  source?: string | null;
  name?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Statuses that indicate a live/production candidate (schema: migration 040). */
const PRODUCTION_STATUSES: ReadonlySet<string> = new Set([
  'needs_review',
  'converted_to_account',
  'approved',
  'generated',
  'normalized',
]);

const DISCARDED_STATUS = 'discarded';
const DUPLICATE_STATUS = 'duplicate';
const EXACT_DUPLICATE_MATCH = 'exact_duplicate';
const IMPORT_SOURCE = 'external_import';
const SMOKE_SOURCE_PRIMARY = 'smoke_script';
const CONVERTED_STATUS = 'converted_to_account';

// ── HARDENING-1 · marcadores explícitos de NO-producción ─────────────────────
//
// Claves EXACTAS, nunca substring ni regex sobre nombres de clave: un texto
// comercial legítimo no puede activarlas por accidente.

/** Presentes con valor `false` ⇒ la ejecución no estaba permitida/autorizada. */
const NONPRODUCTION_FALSE_MARKERS: readonly string[] = [
  'execution_authorized',
  'provider_calls_allowed',
];

/** Presentes con valor `true` ⇒ la ejecución explícitamente no ocurrió. */
const NONPRODUCTION_TRUE_MARKERS: readonly string[] = ['live_pilot_not_executed'];

/**
 * Pistas que se OBSERVAN y no deciden por sí solas.
 *
 * `do_not_sync_hubspot` describe una política de sincronización: una corrida
 * REAL puede pedir deliberadamente no sincronizar. `runner_required` describe
 * cómo se ejecuta algo, no si se ejecutó. Tratar cualquiera de las dos como
 * prueba de no-producción invalidaría corridas legítimas.
 */
const NONPRODUCTION_NON_DECISIVE_HINTS: readonly string[] = [
  'do_not_sync_hubspot',
  'runner_required',
];

/** Marcadores booleanos de smoke (además de los ya existentes). */
const SMOKE_TRUE_KEYS: readonly string[] = ['smoke_test', 'smoke', 'is_smoke', 'smoke_run'];

/** Marcadores booleanos de QA/test. */
const QA_TRUE_KEYS: readonly string[] = [
  'qa_only',
  'qa',
  'qa_run',
  'test',
  'is_test',
  'test_run',
  'do_not_use_for_sales',
  'do_not_convert',
];

/**
 * Marcador estructurado de limpieza de QA. Su PRESENCIA basta: el texto exacto
 * («Descartado por limpieza de QA visual: batch de prueba previo a v1.8.1») es
 * un detalle de una corrida concreta, no un contrato.
 */
const QA_CLEANUP_KEY = 'qa_cleanup';

/** Datos fabricados: fixture / seed / sintético declarado. */
const SYNTHETIC_TRUE_KEYS: readonly string[] = [
  'synthetic',
  'is_synthetic',
  'fixture',
  'is_fixture',
  'seed',
  'seeded',
];

/** Limpieza histórica declarada en metadata. */
const CLEANUP_TRUE_KEYS: readonly string[] = ['historical_cleanup', 'cleanup'];

/** Import externo declarado en metadata. */
const IMPORT_TRUE_KEYS: readonly string[] = ['import', 'external_import'];

/**
 * `source_primary` que SÍ acredita una corrida automatizada real. `manual`,
 * `other`, `external_import` y `smoke_script` quedan fuera a propósito: describen
 * a un humano, a lo desconocido, o a rutas que ya tienen su propia regla.
 */
const PRODUCTION_PROVENANCE_SOURCE_PRIMARY: ReadonlySet<string> = new Set([
  'apollo',
  'lusha',
  'web_ai',
  'hubspot',
  'public_source',
  'preloaded',
  'socrata_colombia',
  'denue_mexico',
  'datos_gob_cl',
]);

/** `prospect_batches.source` que acredita una corrida real (no manual/importada). */
const PRODUCTION_PROVENANCE_BATCH_SOURCE: ReadonlySet<string> = new Set([
  'agent_1',
  'apollo',
  'socrata_colombia',
  'denue_mexico',
  'datos_gob_cl',
]);

// Confidence tiers.
const CONFIDENCE_EXPLICIT_FIELD = 95;
const CONFIDENCE_METADATA = 90;
const CONFIDENCE_STATUS = 90;
const CONFIDENCE_PRODUCTION_STATUS = 80;
const CONFIDENCE_REVIEW_NOTE = 70;
const CONFIDENCE_BATCH = 60;
const CONFIDENCE_COMMERCIAL_LOW = 40;
const CONFIDENCE_DISCARDED_UNKNOWN = 30;
const CONFIDENCE_FALLBACK = 10;

// Case-insensitive Spanish/marker patterns (matched against review_notes).
const SMOKE_NOTE_RE = /smoke/i;
const QA_NOTE_RE = /\bqa\b/i;
const CLEANUP_NOTE_RE = /limpieza\s+hist[oó]rica/i;
const OUTSIDE_ICP_NOTE_RE = /fuera\s+de(?:l)?\s+segmento/i;
const SYNTHETIC_NOTE_RE = /sint[eé]tic/i;

// ─────────────────────────────────────────────────────────────────────────────
// Null-safe accessors
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asTrimmedLower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asNoteText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `true` sólo para un valor declarado, no para un `undefined` ni un `''`. */
function isPresentValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().length > 0;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// HARDENING-1 · ámbitos de metadata donde se buscan marcadores exactos
// ─────────────────────────────────────────────────────────────────────────────

type MetadataScope = { scope: Record<string, unknown>; source: ClassificationSource };

/**
 * Ámbitos donde puede vivir un marcador: la metadata del candidato, sus
 * `review_flags`, y la metadata del lote — cada uno con sus hijos DIRECTOS que
 * sean objetos (profundidad 2, para cubrir contenedores como `context` sin tener
 * que adivinar su nombre).
 *
 * La profundidad acotada es segura porque el emparejamiento es por clave EXACTA:
 * la única forma de activar un marcador es que la clave exista literalmente.
 */
function metadataScopes(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): MetadataScope[] {
  const scopes: MetadataScope[] = [];

  const push = (raw: unknown, source: ClassificationSource): void => {
    const record = asRecord(raw);
    if (Object.keys(record).length === 0) return;
    scopes.push({ scope: record, source });
    for (const value of Object.values(record)) {
      const child = asRecord(value);
      if (Object.keys(child).length > 0) scopes.push({ scope: child, source });
    }
  };

  push(candidate.metadata, 'derived_metadata');
  push(candidate.review_flags, 'derived_metadata');
  if (batch) push(batch.metadata, 'derived_batch');

  return scopes;
}

/** Primera fuente donde alguna de las claves está en `true`. */
function findTrueMarker(scopes: readonly MetadataScope[], keys: readonly string[]): ClassificationSource | null {
  for (const { scope, source } of scopes) {
    for (const key of keys) {
      if (scope[key] === true) return source;
    }
  }
  return null;
}

/**
 * Evidencia EXPLÍCITA de que la corrida no ocurrió o no estaba autorizada.
 *
 * El caso real que cierra: un registro de EC-SCVS nunca ejecutado llevaba
 * `provider_calls_allowed=false`, `live_pilot_not_executed=true` y
 * `execution_authorized=false` y, aun así, un `status='needs_review'` legítimo lo
 * hacía aterrizar en R7 `production_status` con confianza 80.
 */
export function detectExplicitNonProductionExecution(
  candidate: ClassifiableCandidate,
  batch?: ClassifiableBatch,
): ClassificationSource | null {
  const scopes = metadataScopes(candidate, batch);
  for (const { scope, source } of scopes) {
    for (const key of NONPRODUCTION_FALSE_MARKERS) {
      if (scope[key] === false) return source;
    }
    for (const key of NONPRODUCTION_TRUE_MARKERS) {
      if (scope[key] === true) return source;
    }
  }
  return null;
}

/** `true` si sólo hay pistas débiles, que se declaran pero no deciden. */
function hasNonDecisiveNonProductionHint(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): boolean {
  for (const { scope } of metadataScopes(candidate, batch)) {
    for (const key of NONPRODUCTION_NON_DECISIVE_HINTS) {
      if (scope[key] === true) return true;
    }
  }
  return false;
}

/**
 * Evidencia POSITIVA de que la fila salió de una corrida real: un proveedor
 * automatizado en `source_primary`, un lote de corrida real, o una fila que
 * terminó convertida en cuenta.
 *
 * Sólo la consume la regla de motivo comercial (R6): una nota de revisión no
 * puede ser la ÚNICA señal que eleve un origen ambiguo a `production`.
 */
export function hasPositiveProductionProvenance(
  candidate: ClassifiableCandidate,
  batch?: ClassifiableBatch,
): boolean {
  if (PRODUCTION_PROVENANCE_SOURCE_PRIMARY.has(asTrimmedLower(candidate.source_primary))) return true;
  if (asTrimmedLower(candidate.status) === CONVERTED_STATUS) return true;
  if (batch && PRODUCTION_PROVENANCE_BATCH_SOURCE.has(asTrimmedLower(batch.source))) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker detectors — each returns the driving ClassificationSource or null.
// Candidate signals win over batch signals; a batch hit reports `derived_batch`.
// ─────────────────────────────────────────────────────────────────────────────

function detectSmoke(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): ClassificationSource | null {
  if (asTrimmedLower(candidate.source_primary) === SMOKE_SOURCE_PRIMARY) {
    return 'derived_source_primary';
  }
  const meta = asRecord(candidate.metadata);
  if (meta.smoke_test === true) return 'derived_metadata';
  if (typeof meta.smoke_type === 'string' && meta.smoke_type.trim().length > 0) return 'derived_metadata';
  if (typeof meta.created_by_script === 'string' && meta.created_by_script.toLowerCase().includes('smoke')) {
    return 'derived_metadata';
  }
  // HARDENING-1 — el resto de la familia declarada, por clave exacta.
  const trueMarker = findTrueMarker(metadataScopes(candidate, batch), SMOKE_TRUE_KEYS);
  if (trueMarker) return trueMarker;
  if (SMOKE_NOTE_RE.test(asNoteText(candidate.review_notes))) return 'derived_review_notes';

  if (batch && batchIndicatesSmoke(batch)) return 'derived_batch';
  return null;
}

function batchIndicatesSmoke(batch: ClassifiableBatch): boolean {
  const source = asTrimmedLower(batch.source);
  const name = asTrimmedLower(batch.name);
  if (/smoke/.test(source) || /smoke/.test(name)) return true;
  if (/\btest\b/.test(source) || /\btest\b/.test(name)) return true;
  const meta = asRecord(batch.metadata);
  if (meta.smoke_test === true) return true;
  if (typeof meta.smoke_type === 'string' && meta.smoke_type.trim().length > 0) return true;
  return false;
}

function detectQa(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): ClassificationSource | null {
  const scopes = metadataScopes(candidate, batch);

  // do_not_use_for_sales / do_not_convert are grouped as QA/test markers by the
  // canonical novelty-checker detector; we honor that grouping here.
  //
  // HARDENING-1 — se suman `qa`, `qa_run`, `test`, `is_test` y `test_run`, y la
  // PRESENCIA del marcador estructurado `qa_cleanup`, que antes no se reconocía y
  // dejaba caer 15 filas de limpieza de QA visual en `unknown`.
  const trueMarker = findTrueMarker(scopes, QA_TRUE_KEYS);
  if (trueMarker) return trueMarker;
  for (const { scope, source } of scopes) {
    if (isPresentValue(scope[QA_CLEANUP_KEY])) return source;
  }
  if (QA_NOTE_RE.test(asNoteText(candidate.review_notes))) return 'derived_review_notes';

  if (batch && batchIndicatesQa(batch)) return 'derived_batch';
  return null;
}

function batchIndicatesQa(batch: ClassifiableBatch): boolean {
  if (QA_NOTE_RE.test(asNoteText(batch.source)) || QA_NOTE_RE.test(asNoteText(batch.name))) return true;
  const meta = asRecord(batch.metadata);
  return meta.qa_only === true;
}

/**
 * HARDENING-1 — datos declaradamente FABRICADOS (fixture, seed, sintético). Sólo
 * por marcador estructurado: una nota que diga «sintético» sigue siendo texto
 * libre y no clasifica por sí sola (el fold a `smoke_test` de R1 la cubre).
 */
function detectSynthetic(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): ClassificationSource | null {
  return findTrueMarker(metadataScopes(candidate, batch), SYNTHETIC_TRUE_KEYS);
}

function detectHistoricalCleanup(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): ClassificationSource | null {
  if (CLEANUP_NOTE_RE.test(asNoteText(candidate.review_notes))) return 'derived_review_notes';
  const cleanup = asRecord(asRecord(candidate.metadata).logical_cleanup);
  if (cleanup.cleanup_mode === 'logical_only') return 'derived_metadata';
  // HARDENING-1 — limpieza declarada por marcador exacto. `qa_cleanup` NO entra
  // aquí: lo resuelve R2 antes, porque su ORIGEN es la corrida de QA.
  return findTrueMarker(metadataScopes(candidate, batch), CLEANUP_TRUE_KEYS);
}

function detectImport(
  candidate: ClassifiableCandidate,
  batch: ClassifiableBatch | undefined,
): ClassificationSource | null {
  if (asTrimmedLower(candidate.source_primary) === IMPORT_SOURCE) return 'derived_source_primary';
  if (batch && asTrimmedLower(batch.source) === IMPORT_SOURCE) return 'derived_batch';
  // HARDENING-1 — import declarado por marcador exacto.
  return findTrueMarker(metadataScopes(candidate, batch), IMPORT_TRUE_KEYS);
}

function isDuplicate(candidate: ClassifiableCandidate): boolean {
  return (
    asTrimmedLower(candidate.status) === DUPLICATE_STATUS ||
    asTrimmedLower(candidate.duplicate_status) === EXACT_DUPLICATE_MATCH
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main classifier — top-down, first match wins (R1 → R9).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the record origin + rejection reason for a candidate. Pure; the input
 * objects are read-only and never mutated.
 *
 * Priority is strict top-down, y el ORDEN es el contrato:
 *
 *   smoke (R1) > QA (R2) > synthetic (R2b) > cleanup (R3) > import (R4)
 *     > unexecuted/unauthorized (R4b)
 *     > duplicate (R5) > outside-ICP (R6) > production status (R7)
 *     > discarded-unknown (R8) > fallback (R9)
 *
 * Es decir: TODA la evidencia explícita de no-producción (R1–R4b) se resuelve
 * ANTES de cualquier inferencia de producción (R5–R7). Un `status` legítimo por
 * sí solo nunca gana a un marcador explícito.
 *
 * ⚠️ NO es autoridad suficiente para un backfill histórico: sobre filas
 * antiguas puede seguir habiendo ambigüedad que sólo resuelve procedencia
 * auditada externa a esta función.
 */
export function deriveRecordOriginClassification(
  candidate: ClassifiableCandidate,
  batch?: ClassifiableBatch,
): RecordOriginClassification {
  const status = asTrimmedLower(candidate.status);
  const isDiscarded = status === DISCARDED_STATUS;
  const noteText = asNoteText(candidate.review_notes);

  // Pistas débiles: se declaran en las reglas de INFERENCIA (R5–R9), donde el
  // lector necesita saber que se vieron y que no bastaron. Nunca deciden.
  const hasWeakHint = hasNonDecisiveNonProductionHint(candidate, batch);
  const withHints = (warnings: readonly ClassificationWarning[]): ClassificationWarning[] =>
    hasWeakHint ? [...warnings, 'nonproduction_hint_not_decisive'] : [...warnings];

  // ── R1 — smoke ──────────────────────────────────────────────────────────────
  const smokeSource = detectSmoke(candidate, batch);
  if (smokeSource) {
    const warnings: ClassificationWarning[] = [];
    if (smokeSource === 'derived_batch') warnings.push('batch_origin_used');
    if (
      SYNTHETIC_NOTE_RE.test(noteText) ||
      /synth|sint/i.test(asTrimmedLower(asRecord(candidate.metadata).smoke_type))
    ) {
      warnings.push('synthetic_folded_into_smoke_test');
    }
    return {
      recordOrigin: 'smoke_test',
      rejectionReason: isDiscarded ? 'test_record' : null,
      classificationSource: smokeSource,
      classificationConfidence: confidenceForSource(smokeSource),
      matchedRule: 'smoke_marker',
      warnings,
    };
  }

  // ── R2 — QA ───────────────────────────────────────────────────────────────────
  const qaSource = detectQa(candidate, batch);
  if (qaSource) {
    const warnings: ClassificationWarning[] = [];
    if (qaSource === 'derived_batch') warnings.push('batch_origin_used');
    return {
      recordOrigin: 'qa',
      rejectionReason: isDiscarded ? 'test_record' : null,
      classificationSource: qaSource,
      classificationConfidence: confidenceForSource(qaSource),
      matchedRule: 'qa_marker',
      warnings,
    };
  }

  // ── R2b — synthetic / fixture / seed (HARDENING-1) ───────────────────────────
  // `synthetic` ya existe en el vocabulario de la CHECK de la migración 093, así
  // que no hace falta un valor nuevo en base de datos.
  const syntheticSource = detectSynthetic(candidate, batch);
  if (syntheticSource) {
    const warnings: ClassificationWarning[] = ['explicit_nonproduction_marker'];
    if (syntheticSource === 'derived_batch') warnings.push('batch_origin_used');
    return {
      recordOrigin: 'synthetic',
      rejectionReason: isDiscarded ? 'test_record' : null,
      classificationSource: syntheticSource,
      classificationConfidence: confidenceForSource(syntheticSource),
      matchedRule: 'synthetic_marker',
      warnings,
    };
  }

  // ── R3 — historical cleanup ─────────────────────────────────────────────────
  const cleanupSource = detectHistoricalCleanup(candidate, batch);
  if (cleanupSource) {
    return {
      recordOrigin: 'historical_cleanup',
      rejectionReason: isDiscarded ? 'cleanup_record' : null,
      classificationSource: cleanupSource,
      classificationConfidence: confidenceForSource(cleanupSource),
      matchedRule: 'historical_cleanup_note',
      warnings: [],
    };
  }

  // ── R4 — import ────────────────────────────────────────────────────────────────
  const importSource = detectImport(candidate, batch);
  if (importSource) {
    const warnings: ClassificationWarning[] = [];
    if (importSource === 'derived_batch') warnings.push('batch_origin_used');
    // A discarded import with no better reason: 'unknown'. Otherwise null.
    return {
      recordOrigin: 'import',
      rejectionReason: isDiscarded ? 'unknown' : null,
      classificationSource: importSource,
      classificationConfidence: confidenceForSource(importSource),
      matchedRule: 'external_import',
      warnings,
    };
  }

  // ── R4b — ejecución NO ocurrida / NO autorizada (HARDENING-1) ────────────────
  //
  // Es la regla que corrige el falso `production` de EC-SCVS: un registro que
  // declara que la ejecución no ocurrió o no estaba autorizada no puede quedar
  // clasificado por su `status`, aunque ese status sea legítimo.
  //
  // El origen es `unknown`, no `synthetic` ni `qa`: la fila no es un dato
  // fabricado ni la salida de una corrida de QA — es un plan que nunca corrió, y
  // de él NO se puede afirmar procedencia. `unknown` es el valor fail-closed del
  // vocabulario existente, y los cuatro gates de la cola limpia ya lo rechazan.
  const unexecutedSource = detectExplicitNonProductionExecution(candidate, batch);
  if (unexecutedSource) {
    const warnings: ClassificationWarning[] = ['explicit_nonproduction_marker'];
    if (unexecutedSource === 'derived_batch') warnings.push('batch_origin_used');
    return {
      recordOrigin: 'unknown',
      rejectionReason: isDiscarded ? 'unknown' : null,
      classificationSource: unexecutedSource,
      classificationConfidence: confidenceForSource(unexecutedSource),
      matchedRule: 'unexecuted_or_unauthorized',
      warnings,
    };
  }

  // ── R5 — duplicate ───────────────────────────────────────────────────────────
  // No test/cleanup/import markers matched, so a duplicate is a production
  // pipeline outcome flagged as a repeat.
  if (isDuplicate(candidate)) {
    return {
      recordOrigin: 'production',
      rejectionReason: 'duplicate',
      classificationSource: 'derived_status',
      classificationConfidence: CONFIDENCE_STATUS,
      matchedRule: 'duplicate_status',
      warnings: withHints([]),
    };
  }

  // ── R6 — outside ICP (HARDENING-1: la nota NO prueba producción) ──────────────
  //
  // Antes esta regla devolvía `production` por el SOLO hecho de que la nota de
  // revisión mencionara «fuera del segmento». Una frase comercial legítima —o una
  // frase comercial con basura de QA pegada— no es prueba de que la fila saliera
  // de una corrida real: `axZXzxxZ` en la nota de un registro sin ninguna
  // procedencia positiva bastaba para afirmarlo.
  //
  // Ahora la nota conserva el MOTIVO (`outside_icp`, que es lo que aporta) y el
  // ORIGEN sólo se afirma si hay evidencia positiva independiente.
  if (OUTSIDE_ICP_NOTE_RE.test(noteText)) {
    const provenanced = hasPositiveProductionProvenance(candidate, batch);
    return {
      recordOrigin: provenanced ? 'production' : 'unknown',
      rejectionReason: 'outside_icp',
      classificationSource: 'derived_review_notes',
      classificationConfidence: provenanced
        ? CONFIDENCE_COMMERCIAL_LOW
        : CONFIDENCE_DISCARDED_UNKNOWN,
      matchedRule: 'outside_icp_note',
      warnings: withHints(
        provenanced
          ? ['commercial_reason_low_confidence']
          : ['commercial_reason_low_confidence', 'production_evidence_insufficient'],
      ),
    };
  }

  // ── R7 — clean production status ──────────────────────────────────────────────
  // Se llega aquí sólo cuando NINGÚN marcador explícito de no-producción matcheó
  // (R1–R4b), que es la garantía que este hito añade.
  if (PRODUCTION_STATUSES.has(status)) {
    return {
      recordOrigin: 'production',
      rejectionReason: null,
      classificationSource: 'derived_status',
      classificationConfidence: CONFIDENCE_PRODUCTION_STATUS,
      matchedRule: 'production_status',
      warnings: withHints([]),
    };
  }

  // ── R8 — discarded with no marker ─────────────────────────────────────────────
  if (isDiscarded) {
    const warnings: ClassificationWarning[] = ['unknown_discarded_reason'];
    if (noteText.trim().length > 0) warnings.push('ambiguous_review_note');
    return {
      recordOrigin: 'unknown',
      rejectionReason: 'unknown',
      classificationSource: 'derived_status',
      classificationConfidence: CONFIDENCE_DISCARDED_UNKNOWN,
      matchedRule: 'discarded_unknown',
      warnings: withHints(warnings),
    };
  }

  // ── R9 — fallback ───────────────────────────────────────────────────────────────
  return {
    recordOrigin: 'unknown',
    rejectionReason: null,
    classificationSource: 'unknown',
    classificationConfidence: CONFIDENCE_FALLBACK,
    matchedRule: 'fallback_unknown',
    warnings: withHints([]),
  };
}

function confidenceForSource(source: ClassificationSource): number {
  switch (source) {
    case 'derived_source_primary':
      return CONFIDENCE_EXPLICIT_FIELD;
    case 'derived_metadata':
      return CONFIDENCE_METADATA;
    case 'derived_status':
      return CONFIDENCE_STATUS;
    case 'derived_review_notes':
      return CONFIDENCE_REVIEW_NOTE;
    case 'derived_batch':
      return CONFIDENCE_BATCH;
    default:
      return CONFIDENCE_FALLBACK;
  }
}
