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
import {
  computeDiscardDispositionSourceKey,
  mapApolloFinalDispositionToCode,
} from "./mapping";
import {
  classifyPreWriterCandidatesAgainstWriter,
  summarizeWriterGapCauses,
  type PreWriterCandidateLike,
  type WriterGapVerdict,
  type WriterOutcomeLike,
} from "./writer-gap";
import type { CreateDiscardedDispositionInput } from "./types";

/**
 * AGENT1-DISCARDED-TRACEABILITY-1 — las dos disposiciones que la taxonomía pura
 * marca como PRE-writer. Su desenlace REAL sólo lo sabe el writer.
 */
const PRE_WRITER_FINAL_DISPOSITIONS: ReadonlySet<string> = new Set([
  "provisionally_persisted_pending_writer_final",
  "persisted_review_only_final",
]);

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
  };
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
    const identityByKey = new Map(
      input.evaluatedCandidates.map((c) => [c.candidateKey, c.identity]),
    );
    const enrichmentByKey = new Map(
      input.evaluatedCandidates.map((c) => [
        c.candidateKey,
        c.enrichment ?? null,
      ]),
    );

    // AGENT1-DISCARDED-TRACEABILITY-1 — el veredicto del writer por candidata
    // pre-writer. Sin `writerOutcome` el mapa queda vacío y esas candidatas se
    // saltan igual que antes de este hito.
    const writerVerdicts = input.writerOutcome
      ? classifyPreWriterCandidatesAgainstWriter(
          input.writerOutcome.preWriterCandidates,
          {
            candidatesCreated: input.writerOutcome.candidatesCreated,
            skipped: input.writerOutcome.skipped,
          },
        )
      : new Map<string, WriterGapVerdict>();
    const writerGapCauses = input.writerOutcome
      ? summarizeWriterGapCauses(input.writerOutcome.skipped)
      : null;

    const rows: CreateDiscardedDispositionInput[] = [];
    for (const entry of input.finalDispositions) {
      let code = mapApolloFinalDispositionToCode(entry.finalDisposition);

      // AGENT1-DISCARDED-TRACEABILITY-1 — una disposición PRE-writer no es un
      // rechazo… mientras el writer haya creado la fila. Cuando no la creó, la
      // empresa se queda sin fila de candidato Y sin fila de disposición: es la
      // #17 del E2E del 2026-09-04. Aquí recupera un destino terminal.
      let writerGap: Extract<WriterGapVerdict, { kind: "not_created" }> | null =
        null;
      if (
        code === null &&
        PRE_WRITER_FINAL_DISPOSITIONS.has(entry.finalDisposition)
      ) {
        const verdict = writerVerdicts.get(entry.candidateKey);
        if (verdict?.kind === "not_created") {
          writerGap = verdict;
          // Vocabulario YA existente en el CHECK de la migración 138 y en
          // `DiscardDispositionCode`: no hace falta esquema nuevo.
          code = "final_validation_rejected";
        } else if (verdict?.kind === "indeterminate") {
          // Ni creada ni descartada demostrablemente. No se persiste: afirmar un
          // descarte sin evidencia sería exactamente el dato inventado que este
          // hito evita. Se cuenta para que el hueco sea visible.
          result.writerGapIndeterminate += 1;
        }
      }
      // `verdict.kind === 'created'` cae aquí con `code === null`: una candidata
      // que SÍ se creó nunca aparece en «Descartadas».
      if (code === null) continue;

      const identity = identityByKey.get(entry.candidateKey);
      const name = identity?.canonicalName?.trim();
      if (!name) continue; // No usable name to show — nothing to persist.

      const enrichment = enrichmentByKey.get(entry.candidateKey) ?? null;

      rows.push({
        batchId: input.batchId,
        providerIdentifier: identity?.providerOrganizationId ?? null,
        sourceKey: computeDiscardDispositionSourceKey({
          domain: identity?.normalizedDomain ?? null,
          providerIdentifier: identity?.providerOrganizationId ?? null,
          name,
        }),
        name,
        domain: identity?.normalizedDomain ?? null,
        countryCode: input.requestedCountryCode,
        industry: input.requestedIndustry,
        sourcePrimary: input.sourcePrimary,
        roundOrigin: `round_${entry.roundNumber}`,
        disposition: code,
        // Para un hueco del writer, `reason_code` conserva la disposición
        // ORIGINAL del orquestador — la trazabilidad hacia el vocabulario de
        // origen, sin reinterpretarlo.
        reasonCode: entry.finalDisposition,
        reasonDetail: writerGap ? writerGap.reason : entry.finalReason,
        evidence: {
          candidate_key: entry.candidateKey,
          round_number: entry.roundNumber,
          final_disposition: entry.finalDisposition,
          final_reason: entry.finalReason,
          requested_country_code: input.requestedCountryCode,
          requested_industry: input.requestedIndustry,
          // AGENT1-DISCARDED-TRACEABILITY-1 — A vs B. `null` significa «no se
          // informó», no «no se intentó»: la ausencia nunca se rellena.
          enrichment_attempted: enrichment ? enrichment.attempted : null,
          enrichment_status: enrichment ? enrichment.status : null,
          enrichment_recorded_credits: enrichment
            ? enrichment.recordedCredits
            : null,
          enrichment_operation_ids: enrichment
            ? [...enrichment.operationIds]
            : null,
          // AGENT1-DISCARDED-TRACEABILITY-1 — cómo se SABE que el writer no
          // creó esta fila, y el desglose de motivos con el que saltó filas en
          // esta corrida. `null` en una fila que no viene de un hueco del writer.
          writer_gap: writerGap
            ? {
                evidence: writerGap.evidence,
                reason: writerGap.reason,
                original_final_disposition: entry.finalDisposition,
              }
            : null,
          writer_gap_causes: writerGap ? writerGapCauses : null,
        },
      });
      if (writerGap) result.writerGapRows += 1;
    }

    // AGENT1-DISCARDED-TRACEABILITY-1 — deduplicación DENTRO del payload.
    //
    // `UNIQUE (batch_id, source_key)` sólo protege entre llamadas: un mismo
    // `.upsert()` con dos filas de la misma `source_key` hace fallar el comando
    // entero en Postgres («ON CONFLICT DO UPDATE command cannot affect row a
    // second time»), y con él las 16 filas legítimas. Gana la PRIMERA: el bucle
    // recorre `finalDispositions` en el orden del orquestador, así que la
    // primera es la de la ronda más temprana.
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
