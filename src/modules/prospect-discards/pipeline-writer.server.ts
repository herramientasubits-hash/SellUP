// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — best-effort, additive persistence of
// every terminal REJECTION the Apollo two-round pipeline already computed
// (`evaluateApolloCandidateFinalDispositions`, pure, unchanged) as a durable
// row in `prospect_discarded_dispositions`.
//
// Deliberately isolated from the orchestrator/production-runner:
//   - reads ONLY data already computed in memory (`ResumedCandidate.identity`,
//     the final-disposition entries) — makes ZERO provider calls of its own.
//   - writes ONLY the new table — never touches `prospect_candidates`,
//     `prospect_batches`, budget, or credit tables.
//   - NEVER throws. Every failure is caught, logged, and reported in the
//     returned summary — a persistence failure here must never fail or alter
//     the run's own result.
//
// Called exactly once per production write, from
// `production-runner.server.ts`, AFTER the existing candidate writer already
// ran — so it cannot affect candidate creation, budget, or existing counts.

import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { OwnershipGateVerdictLike } from "./mapping";
import type { PreWriterCandidateLike, WriterOutcomeLike } from "./writer-gap";
import { buildDiscardedDispositionRows } from "./dispositions-row-builder";
import type { CreateDiscardedDispositionInput } from "./types";

/** Minimal shape this module needs from a final-disposition entry. Kept as a
 *  structural type (not imported from the orchestrator) to avoid coupling
 *  this module's types to the Apollo pipeline's internal types. */
export interface FinalDispositionEntryLike {
  candidateKey: string;
  roundNumber: number;
  finalDisposition: string;
  finalReason: string | null;
}

/**
 * AGENT1-DISCARDED-TRACEABILITY-1 — lo que la corrida ya sabe del enrichment de
 * UN candidato, en el momento en que este escritor corre.
 *
 * El dato que faltaba: `enrichment_budget_exhausted` se leía como "no se gastó
 * nada en esta empresa", y eso no es cierto para una candidata que SÍ pagó un
 * `organization_enrichment` y aun así perdió su cupo en un reintento posterior.
 * Sin esto, el caso A (presupuesto agotado ANTES del intento) y el caso B (se
 * intentó y Apollo cobró) son indistinguibles en la fila persistida.
 *
 * `attempted` es lo mínimo. `recordedCredits` y `operationIds` vienen de
 * `enrichment_snapshots` —contabilidad que la corrida YA tiene— y son lo que
 * permite atar la fila a `provider_usage_logs` sin volver a consultar a nadie.
 */
export interface EvaluatedCandidateEnrichmentFactsLike {
  attempted: boolean;
  /** `ApolloTwoRoundEnrichmentStatus` tal cual. Nunca reinterpretado aquí. */
  status: string | null;
  /** Créditos que NUESTRO ledger registró. `null` ⇒ indeterminado, jamás 0. */
  recordedCredits: number | null;
  /** `operation_id` de cada enrichment de este candidato. Join con usage logs. */
  operationIds: readonly string[];
}

/** Minimal shape this module needs from a resumed candidate's identity. */
export interface EvaluatedCandidateIdentityLike {
  candidateKey: string;
  identity: {
    providerOrganizationId: string | null;
    normalizedDomain: string | null;
    canonicalName: string | null;
    /**
     * 🔴 AGENT1-OWNERSHIP-OBSERVABILITY-X3 — el LinkedIn normalizado, que la
     * corrida ya tenía en `NormalizedOrganizationIdentity` y que hasta ahora no
     * viajaba hasta aquí.
     *
     * Es evidencia de propiedad que el auditor necesita y que el gate NO mira:
     * `linkedin.com/company/caribe-supermercados` frente a
     * `caribesupermercados.co` se lee solo. Persistirlo no lo mete en ninguna
     * decisión — eso sería D3, y queda fuera de este corte.
     */
    normalizedLinkedInUrl?: string | null;
  };
  /**
   * 🔴 X3 — el nombre CRUDO del proveedor, el que el gate juzgó de verdad.
   *
   * `identity.canonicalName` no sirve para auditar: ordena los tokens
   * alfabéticamente y es irreversible. Ausente ⇒ `null`, nunca el canónico.
   */
  providerRawName?: string | null;
  /**
   * 🔴 X3 — el veredicto EXACTO de `evaluateCompanyOwnership`, propagado tal
   * cual desde donde se produjo. Ausente o `null` ⇒ el gate no corrió sobre esta
   * empresa, y así se persiste: `ownership_gate: null` con
   * `ownership_gate_source: 'not_evaluated'`. Aquí no se evalúa ownership.
   */
  ownership?: OwnershipGateVerdictLike | null;
  /**
   * Ausente ⇒ «nadie informó», que se persiste como `null`. NUNCA se sustituye
   * por `false`: afirmar "no se intentó" sin saberlo es exactamente el dato
   * inventado que este hito evita.
   */
  enrichment?: EvaluatedCandidateEnrichmentFactsLike | null;
}

/**
 * AGENT1-DISCARDED-TRACEABILITY-1 — lo que hace falta para saber si una
 * candidata pre-writer acabó como fila de candidato o como hueco del writer.
 *
 * Omitirlo conserva EXACTAMENTE el comportamiento anterior a este hito: las
 * disposiciones pre-writer se saltan y no se persiste ninguna fila por ellas.
 */
export interface PersistApolloWriterOutcomeInput extends WriterOutcomeLike {
  preWriterCandidates: readonly PreWriterCandidateLike[];
}

export interface PersistApolloRejectedDispositionsInput {
  batchId: string;
  /** Search-scoped context — the only country/industry available without
   *  threading raw provider organization fields through the pure orchestrator
   *  (out of scope for this hito: no Apollo pipeline changes). */
  requestedCountryCode: string | null;
  requestedIndustry: string | null;
  sourcePrimary: "apollo";
  evaluatedCandidates: readonly EvaluatedCandidateIdentityLike[];
  finalDispositions: readonly FinalDispositionEntryLike[];
  /** Ausente ⇒ comportamiento previo: las pre-writer no dejan fila. */
  writerOutcome?: PersistApolloWriterOutcomeInput | null;
}

export interface PersistApolloRejectedDispositionsResult {
  attempted: number;
  persisted: number;
  failed: number;
  errors: string[];
  /** Filas emitidas por un hueco del writer (`final_validation_rejected`). */
  writerGapRows: number;
  /**
   * Candidatas pre-writer cuyo desenlace NO se pudo afirmar. Se cuentan para
   * que un hueco sin explicar sea visible en vez de silencioso; nunca generan
   * fila, porque generarla sería inventar el descarte.
   */
  writerGapIndeterminate: number;
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Supabase service credentials not configured");
  return createAdminClient(url, key);
}

/**
 * Best-effort UPSERT of one row per terminal rejection. Never throws — every
 * failure is caught and reported via the returned summary. `ON CONFLICT
 * (batch_id, source_key)` is the idempotency guarantee: calling this twice
 * for the same run (e.g. a resumed attempt) never duplicates a row.
 */
export async function persistApolloRejectedDispositions(
  input: PersistApolloRejectedDispositionsInput,
): Promise<PersistApolloRejectedDispositionsResult> {
  const result: PersistApolloRejectedDispositionsResult = {
    attempted: 0,
    persisted: 0,
    failed: 0,
    errors: [],
    writerGapRows: 0,
    writerGapIndeterminate: 0,
  };

  try {
    // AGENT1-OWNERSHIP-OBSERVABILITY-X3 — la construcción de filas vive ahora en
    // `dispositions-row-builder.ts`, pura y sin Supabase. Aquí sólo queda el IO.
    // Ni una regla cambió al mudarse: la evidencia, el hueco del writer y el
    // orden de recorrido son los mismos.
    const built = buildDiscardedDispositionRows({
      batchId: input.batchId,
      requestedCountryCode: input.requestedCountryCode,
      requestedIndustry: input.requestedIndustry,
      sourcePrimary: input.sourcePrimary,
      evaluatedCandidates: input.evaluatedCandidates,
      finalDispositions: input.finalDispositions,
      writerOutcome: input.writerOutcome ?? null,
    });
    const rows = built.rows;
    result.writerGapRows = built.writerGapRows;
    result.writerGapIndeterminate = built.writerGapIndeterminate;


    const rowsBySourceKey = new Map<string, CreateDiscardedDispositionInput>();
    for (const row of rows) {
      if (!rowsBySourceKey.has(row.sourceKey))
        rowsBySourceKey.set(row.sourceKey, row);
    }
    const uniqueRows = [...rowsBySourceKey.values()];

    result.attempted = uniqueRows.length;
    if (uniqueRows.length === 0) return result;

    const supabase = getAdminClient();
    const payload = uniqueRows.map((row) => ({
      batch_id: row.batchId,
      provider_identifier: row.providerIdentifier,
      source_key: row.sourceKey,
      name: row.name,
      domain: row.domain,
      country_code: row.countryCode,
      industry: row.industry,
      source_primary: row.sourcePrimary,
      round_origin: row.roundOrigin,
      disposition: row.disposition,
      reason_code: row.reasonCode,
      reason_detail: row.reasonDetail,
      evidence: row.evidence,
    }));

    const { data, error } = await supabase
      .from("prospect_discarded_dispositions")
      .upsert(payload, {
        onConflict: "batch_id,source_key",
        ignoreDuplicates: false,
      })
      .select("id");

    if (error) {
      result.failed = uniqueRows.length;
      result.errors.push(error.message);
      console.error(
        "[prospect-discards] persistApolloRejectedDispositions upsert failed (non-critical):",
        error,
      );
      return result;
    }

    result.persisted = data?.length ?? uniqueRows.length;
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.failed = result.attempted;
    result.errors.push(message);
    console.error(
      "[prospect-discards] persistApolloRejectedDispositions failed (non-critical):",
      err,
    );
    return result;
  }
}
