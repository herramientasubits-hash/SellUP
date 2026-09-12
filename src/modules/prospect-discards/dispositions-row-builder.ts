// AGENT1-OWNERSHIP-OBSERVABILITY-X3 — el NÚCLEO PURO del escritor de
// disposiciones: de lo que la corrida ya sabe a las filas que se persistirán.
//
// Se extrae de `pipeline-writer.server.ts` sin cambiarle una coma a la lógica.
// El motivo es poder ejercitar la evidencia que X3 añade —`provider_raw_name`,
// `linkedin_url`, `ownership_gate`— sin `mock.module`, que en Node 24 (el de CI)
// ignora `namedExports` y deja salir a la red al módulo real: la suite
// `pipeline-writer.test.ts` es roja en Node 24 justo por eso, y colgar de ella
// la prueba de un corte de observabilidad habría sido construir sobre arena.
//
// Puro: sin Supabase, sin red, sin reloj, sin `process.env`.

import {
  computeDiscardDispositionSourceKey,
  mapApolloFinalDispositionToCode,
  resolveOwnershipGateEvidenceSource,
  toOwnershipGateEvidence,
} from "./mapping";
import {
  classifyPreWriterCandidatesAgainstWriter,
  summarizeWriterGapCauses,
  type WriterGapVerdict,
} from "./writer-gap";
import type { CreateDiscardedDispositionInput } from "./types";
import type {
  EvaluatedCandidateIdentityLike,
  FinalDispositionEntryLike,
  PersistApolloWriterOutcomeInput,
} from "./pipeline-writer.server";

export interface BuildDiscardedDispositionRowsInput {
  batchId: string;
  requestedCountryCode: string | null;
  requestedIndustry: string | null;
  sourcePrimary: "apollo" | "lusha";
  evaluatedCandidates: readonly EvaluatedCandidateIdentityLike[];
  finalDispositions: readonly FinalDispositionEntryLike[];
  writerOutcome?: PersistApolloWriterOutcomeInput | null;
}

export interface BuildDiscardedDispositionRowsResult {
  rows: CreateDiscardedDispositionInput[];
  writerGapRows: number;
  writerGapIndeterminate: number;
}

/**
 * AGENT1-DISCARDED-TRACEABILITY-1 — las dos disposiciones que la taxonomía pura
 * marca como PRE-writer. Su desenlace REAL sólo lo sabe el writer.
 */
const PRE_WRITER_FINAL_DISPOSITIONS: ReadonlySet<string> = new Set([
  "provisionally_persisted_pending_writer_final",
  "persisted_review_only_final",
]);

export function buildDiscardedDispositionRows(
  input: BuildDiscardedDispositionRowsInput,
): BuildDiscardedDispositionRowsResult {
  const result: BuildDiscardedDispositionRowsResult = {
    rows: [],
    writerGapRows: 0,
    writerGapIndeterminate: 0,
  };
  const identityByKey = new Map(
    input.evaluatedCandidates.map((c) => [c.candidateKey, c.identity]),
  );
  const enrichmentByKey = new Map(
    input.evaluatedCandidates.map((c) => [
      c.candidateKey,
      c.enrichment ?? null,
    ]),
  );
  // 🔴 X3 — nombre crudo y veredicto de ownership, indexados por candidata.
  const rawNameByKey = new Map(
    input.evaluatedCandidates.map((c) => [c.candidateKey, c.providerRawName ?? null]),
  );
  const ownershipByKey = new Map(
    input.evaluatedCandidates.map((c) => [c.candidateKey, c.ownership ?? null]),
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
        // 🔴 AGENT1-OWNERSHIP-OBSERVABILITY-X3 — la evidencia con la que se
        // puede auditar un rechazo de ownership sin volver a pagar.
        //
        // El defecto que cierra: `name` guarda `identity.canonicalName`, que
        // ordena los tokens alfabéticamente. El gate, en cambio, juzgó el
        // nombre CRUDO de Apollo, y ese nombre no estaba en ninguna tabla —
        // los siete `ownership_mismatch` del lote `c7c28980…` quedaron sin
        // forma de comprobarse.
        //
        // Nada de esto se recalcula: `ownership_gate` es el veredicto que la
        // corrida ya produjo, copiado. Ausente ⇒ `null` + `not_evaluated`,
        // nunca un veredicto deducido del motivo del descarte.
        provider_raw_name: rawNameByKey.get(entry.candidateKey) ?? null,
        linkedin_url: identity?.normalizedLinkedInUrl ?? null,
        ownership_gate: toOwnershipGateEvidence(
          ownershipByKey.get(entry.candidateKey) ?? null,
        ),
        ownership_gate_source: resolveOwnershipGateEvidenceSource(
          ownershipByKey.get(entry.candidateKey) ?? null,
        ),
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
  result.rows = rows;
  return result;
}
