/**
 * wave1-run-audit.ts — El pack de revisión manual de una corrida de calibración
 * de Wave 1, incluyendo los candidatos que MURIERON antes del writer.
 *
 * AGENT1-APOLLO-SECTOR-EVIDENCE-BOOTSTRAP-1 · § 9.
 *
 * Por qué existe: en una corrida de bootstrap el candidato que calibra Wave 1 es,
 * por construcción, el que NO se persiste. La reevaluación posterior al
 * enrichment corre sin autorización, el sector vuelve a `sector_not_mapped` y el
 * orquestador lo rechaza antes del writer. Un audit que partiera de
 * `prospect_candidates` leería cero filas y concluiría que no hay nada que
 * revisar — cuando lo que hay es hasta cinco enrichments pagados con su evidencia
 * completa.
 *
 * De dónde lee, y de dónde NO:
 *
 *   `prospect_batches.metadata.apollo_sector_evidence_bootstrap`   ← el juicio
 *   `prospect_batches.metadata.apollo_two_round_checkpoint`        ← nombre/dominio
 *   `prospect_candidates`                                          ← NUNCA
 *
 * Uso — el operador exporta el metadata del lote (por MCP numerado, read-only) a
 * un fichero y se lo pasa a este script:
 *
 *   node --import tsx scripts/agent1/wave1-run-audit.ts <batch-metadata.json>
 *   node --import tsx scripts/agent1/wave1-run-audit.ts <fichero> --format=json
 *
 * El script NO abre red, NO consulta Supabase, NO llama al proveedor y NO escribe
 * nada. Es una proyección de un fichero local a TSV o JSON.
 */

import { readFileSync } from 'node:fs';

import {
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY,
  toApolloSectorEvidenceBootstrapManualReviewRows,
  type ApolloSectorEvidenceBootstrapCandidateAudit,
  type ApolloSectorEvidenceBootstrapManualReviewRow,
} from '@/server/agents/prospecting-toolkit/apollo-sector-evidence-bootstrap-audit';
import type { ApolloSectorPostEnrichmentAdmissionResult } from '@/server/agents/prospecting-toolkit/apollo-sector-post-enrichment-admission';
import {
  APOLLO_TWO_ROUND_CHECKPOINT_KEY,
  type ApolloTwoRoundCandidateSnapshot,
} from '@/server/agents/prospecting-toolkit/apollo-two-round/checkpoint';

// ─── Lectura tolerante del documento exportado ────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * POST-ENRICHMENT-ADMISSION-1 § 20 — rehidrata el bloque de admisión sectorial.
 *
 * Estricto donde afirma algo: sólo devuelve `admittedByRequestedSubindustryPrecision:
 * true` si el documento lo dice con un booleano de verdad. Un bloque ausente
 * —lotes anteriores a este hito— se lee como `null`, que significa «nadie lo
 * registró», no «fue legacy».
 */
function readSectorAdmission(raw: unknown): ApolloSectorPostEnrichmentAdmissionResult | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const readString = (key: string): string | null =>
    typeof record[key] === 'string' ? (record[key] as string) : null;
  const admitted = record['admitted_by_requested_subindustry_precision'] === true;
  return {
    sectorEvidenceState: admitted
      ? 'sector_evidence_confirmed'
      : ((readString('post_enrichment_sector_state') ??
          'sector_not_mapped') as ApolloSectorPostEnrichmentAdmissionResult['sectorEvidenceState']),
    admittedByRequestedSubindustryPrecision: admitted,
    admissionSource: (readString('source') ??
      'legacy_sector_policy') as ApolloSectorPostEnrichmentAdmissionResult['admissionSource'],
    matchedRequestedSubindustry: readString('matched_requested_subindustry'),
    // El registro operativo no se rehidrata: su único consumidor es la proyección a
    // metadata, que ya corrió. Inventarlo aquí crearía una segunda verdad.
    operationalConfirmation: null,
    postEnrichmentSectorState: (readString('post_enrichment_sector_state') ??
      'sector_not_mapped') as ApolloSectorPostEnrichmentAdmissionResult['postEnrichmentSectorState'],
    blockReason:
      readString('block_reason') as ApolloSectorPostEnrichmentAdmissionResult['blockReason'],
  };
}

/**
 * Rehidrata un registro del bloque durable.
 *
 * Tolerante con lo que falte y estricto con lo que signifique gasto: un
 * `enrichment_executed` ausente se lee como `false`, nunca como `true`.
 */
function readAuditRecord(raw: unknown): ApolloSectorEvidenceBootstrapCandidateAudit | null {
  const record = asRecord(raw);
  if (record === null || typeof record['candidate_key'] !== 'string') return null;

  const classification = asRecord(record['enriched_classification']);
  const precision = asRecord(record['post_enrichment_precision']);
  const readStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  return {
    candidateKey: record['candidate_key'],
    bootstrapReason: 'provider_classification_missing',
    selectedForEnrichment: record['selected_for_enrichment'] === true,
    selectionRank: typeof record['selection_rank'] === 'number' ? record['selection_rank'] : null,
    enrichmentStatus: (record['enrichment_status'] ??
      'not_attempted') as ApolloSectorEvidenceBootstrapCandidateAudit['enrichmentStatus'],
    enrichmentExecuted: record['enrichment_executed'] === true,
    enrichedClassification:
      classification === null
        ? null
        : {
            industry:
              typeof classification['industry'] === 'string' ? classification['industry'] : null,
            industries: readStrings(classification['industries']),
            keywords: readStrings(classification['keywords']),
            organizationKeywords: readStrings(classification['organization_keywords']),
            hasShortDescription: classification['has_short_description'] === true,
            hasSeoDescription: classification['has_seo_description'] === true,
            hasDescription: classification['has_description'] === true,
            employeeCount:
              typeof classification['employee_count'] === 'number'
                ? classification['employee_count']
                : null,
          },
    // El bloque guarda la precisión ya proyectada a snake_case; el pack sólo
    // necesita las evaluaciones y la evidencia, así que se remonta lo mínimo.
    postEnrichmentPrecision:
      precision === null
        ? null
        : ({
            perRequestedSubindustryEvaluations: (Array.isArray(
              precision['per_requested_subindustry_evaluations'],
            )
              ? precision['per_requested_subindustry_evaluations']
              : []
            ).map((item) => {
              const evaluation = asRecord(item) ?? {};
              return {
                requestedSubindustry: String(evaluation['requested_subindustry'] ?? ''),
                subindustryMapped: evaluation['subindustry_mapped'] === true,
                subindustryMatch: evaluation['subindustry_match'],
                subindustryMatchFamily: evaluation['subindustry_match_family'],
                subindustryConfidence: evaluation['subindustry_confidence'],
                verdictReason: evaluation['verdict_reason'],
              };
            }),
            subindustryEvidence: (Array.isArray(precision['subindustry_evidence'])
              ? precision['subindustry_evidence']
              : []
            ).map((item) => asRecord(item) ?? {}),
          } as unknown as ApolloSectorEvidenceBootstrapCandidateAudit['postEnrichmentPrecision']),
    postEnrichmentSectorState:
      (record['post_enrichment_sector_state'] as
        | ApolloSectorEvidenceBootstrapCandidateAudit['postEnrichmentSectorState']) ?? null,
    sectorAdmission: readSectorAdmission(record['sector_admission']),
    terminalDisposition:
      (record['terminal_disposition'] as
        | ApolloSectorEvidenceBootstrapCandidateAudit['terminalDisposition']) ?? null,
    terminalReason: typeof record['terminal_reason'] === 'string' ? record['terminal_reason'] : null,
  };
}

// ─── Salida ───────────────────────────────────────────────────────────────────

const COLUMNS = [
  'Company',
  'Domain',
  'Enrichment executed',
  'Provider industry',
  'Keywords/descriptions available',
  'Requested subindustry',
  'Diagnostic verdict',
  'Verdict reason',
  'Evidence term@field(source)',
  'Bootstrap reason',
  'Selection rank',
  'Post-enrichment sector state',
  'Sector admission source',
  'Admitted by requested subindustry',
  'Persisted?',
  'Terminal reason',
  'Manual decision',
] as const;

function toTsv(rows: readonly ApolloSectorEvidenceBootstrapManualReviewRow[]): string {
  const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value).replace(/[\t\n\r]+/g, ' ');
  const lines = rows.map((row) =>
    [
      cell(row.company),
      cell(row.domain),
      cell(row.enrichmentExecuted),
      cell(row.providerIndustry),
      cell(row.keywordsOrDescriptionsAvailable),
      cell(row.requestedSubindustry),
      cell(row.diagnosticVerdict),
      cell(row.verdictReason),
      cell(row.evidence.join(' ; ')),
      cell(row.bootstrapReason),
      cell(row.selectionRank),
      cell(row.postEnrichmentSectorState),
      cell(row.sectorAdmissionSource),
      cell(row.admittedByRequestedSubindustry),
      cell(row.persisted),
      cell(row.terminalReason),
      // Columna a rellenar a mano: TRUE_POSITIVE / FALSE_POSITIVE / UNCERTAIN.
      '',
    ].join('\t'),
  );
  return [COLUMNS.join('\t'), ...lines].join('\n');
}

// ─── Entrada ──────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith('--'));
  const asJson = args.includes('--format=json');

  if (path === undefined) {
    console.error(
      'uso: node --import tsx scripts/agent1/wave1-run-audit.ts <batch-metadata.json> [--format=json]',
    );
    process.exitCode = 2;
    return;
  }

  const metadata = asRecord(JSON.parse(readFileSync(path, 'utf8')));
  if (metadata === null) {
    console.error('el fichero no contiene un objeto de metadata de lote');
    process.exitCode = 2;
    return;
  }

  const block = asRecord(metadata[APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY]);
  if (block === null) {
    // No es un error: una corrida con política de sector no produce bootstrap.
    console.error(
      `sin bloque \`${APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY}\`: esta corrida no adquirió evidencia`,
    );
    process.exitCode = 1;
    return;
  }

  const audit = (Array.isArray(block['candidates']) ? block['candidates'] : [])
    .map(readAuditRecord)
    .filter((record): record is ApolloSectorEvidenceBootstrapCandidateAudit => record !== null);

  const checkpoint = asRecord(metadata[APOLLO_TWO_ROUND_CHECKPOINT_KEY]);
  const candidateSnapshots = (
    Array.isArray(checkpoint?.['candidate_snapshots']) ? checkpoint['candidate_snapshots'] : []
  ) as ApolloTwoRoundCandidateSnapshot[];

  const rows = toApolloSectorEvidenceBootstrapManualReviewRows({ audit, candidateSnapshots });

  console.error(
    `autorización=${block['bootstrap_authorized']} · elegibles=${block['bootstrap_eligible_count']} · ` +
      `seleccionados=${block['bootstrap_selected_for_enrichment_count']} · ` +
      `enriquecidos=${block['bootstrap_enrichment_executed_count']} · filas=${rows.length}`,
  );
  console.log(asJson ? JSON.stringify(rows, null, 2) : toTsv(rows));
}

main();
