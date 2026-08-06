/**
 * apollo-enrichment-persistence-capture.ts — Lo que el enrichment devolvió,
 * proyectado a las columnas que `prospect_candidates` sí tiene.
 *
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 · § 4.
 *
 * El defecto que cierra: la corrida `be181d2d…` pagó cinco enrichments y
 * persistió dos candidatos con `city`, `employee_count`, `subindustry`,
 * `sector_code`, `classification_source` y `classification_confidence` TODOS en
 * `null`. Se compró información y no se guardó ni una fila de ella. El perfil
 * enriquecido vivía en `metadata.apollo_profile` del resultado de búsqueda y
 * nadie lo bajaba a columnas.
 *
 * Reglas que gobiernan esta captura, y ninguna es negociable:
 *
 *   1. Sólo se escribe lo que el proveedor DEVOLVIÓ y superó validación. Un campo
 *      ausente se queda ausente; no se deduce del nombre, del dominio ni del
 *      país buscado.
 *   2. Todo dato lleva procedencia: proveedor, operación, id de la petición y
 *      momento de la observación. Un dato sin procedencia no se puede auditar ni
 *      caducar.
 *   3. La subindustria sólo se escribe cuando el veredicto de precisión es
 *      `confirmed` (§ 3). Escribirla en `ambiguous` afirmaría una clasificación
 *      que la evidencia no sostiene.
 *
 * Puro: sin I/O, sin reloj. El instante de observación entra como dato.
 */

import type {
  ApolloSubindustryPrecisionAssessment,
  SubindustryClassificationSource,
} from './apollo-subindustry-precision';
import { toApolloSubindustryPrecisionMetadata } from './apollo-subindustry-precision';
import type { WebSearchResult } from './types';

// ─── Procedencia ──────────────────────────────────────────────────────────────

/** Procedencia de un dato traído por una operación pagada. */
export type ApolloEnrichmentProvenance = {
  sourceProvider: 'apollo';
  sourceOperation: 'organization_enrichment' | 'organizations_search';
  /** `usage_key` o id de la petición. `null` cuando la operación no lo expuso. */
  sourceRequestId: string | null;
  /** ISO-8601. Cuándo se observó el dato. */
  observedAt: string;
};

// ─── Captura ──────────────────────────────────────────────────────────────────

/**
 * Los datos del enrichment listos para columna, con su procedencia.
 *
 * `null` significa «el proveedor no lo devolvió, o no superó validación». Nunca
 * significa cero ni cadena vacía.
 */
export type ApolloEnrichmentPersistenceCapture = {
  city: string | null;
  industry: string | null;
  /** Sólo con `subindustryMatch === 'confirmed'`. */
  subindustry: string | null;
  /**
   * Código sectorial de un catálogo VALIDADO.
   *
   * Apollo no publica códigos de clasificación oficial (CIIU, NAICS, SIC), así
   * que por esta vía llega `null` y `sectorCodeReason` lo dice. Inventar un
   * código a partir del nombre de la industria sería exactamente la suposición
   * que el § 4 prohíbe.
   */
  sectorCode: string | null;
  sectorCodeReason: 'no_validated_catalog_code_available' | 'catalog_code_present';
  classificationSource: SubindustryClassificationSource | null;
  /** 0–100. `null` cuando no hay clasificación que respaldar. */
  classificationConfidence: number | null;
  provenance: ApolloEnrichmentProvenance;
  /** Evidencia y veredicto completos, para la metadata estructurada. */
  precision: ApolloSubindustryPrecisionAssessment;
};

const MAX_LABEL_CHARS = 120;

function readLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, MAX_LABEL_CHARS);
}

/**
 * Lee un campo con la precedencia búsqueda → perfil enriquecido.
 *
 * El enrichment RELLENA lo que la búsqueda dejó vacío; no reemplaza lo que ya
 * estaba. Invertir la precedencia haría que una corrida perdiera un dato bueno
 * de la búsqueda cuando el perfil trae uno peor.
 */
function pick(meta: Record<string, unknown>, key: string): unknown {
  const direct = meta[key];
  if (direct !== undefined && direct !== null && direct !== '') return direct;
  const profile = meta['apollo_profile'];
  if (typeof profile === 'object' && profile !== null && !Array.isArray(profile)) {
    return (profile as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * Captura lo persistible de un resultado ya enriquecido.
 *
 * `catalogSectorCode` permite inyectar un código desde un catálogo validado
 * cuando exista; sin él la captura declara por qué no hay código, en vez de
 * dejar un `null` mudo.
 */
export function captureApolloEnrichmentForPersistence(input: {
  result: WebSearchResult;
  precision: ApolloSubindustryPrecisionAssessment;
  provenance: ApolloEnrichmentProvenance;
  catalogSectorCode?: string | null;
}): ApolloEnrichmentPersistenceCapture {
  const meta = (input.result.metadata ?? {}) as Record<string, unknown>;
  const confirmed = input.precision.subindustryMatch === 'confirmed';
  const catalogSectorCode = readLabel(input.catalogSectorCode);

  return {
    city: readLabel(pick(meta, 'city')),
    industry: readLabel(pick(meta, 'industry')),
    // § 3 — una subindustria ambigua NO se escribe: la columna quedaría
    // afirmando una pertenencia que la evidencia no demuestra.
    subindustry: confirmed ? readLabel(input.precision.requestedSubindustry) : null,
    sectorCode: catalogSectorCode,
    sectorCodeReason:
      catalogSectorCode === null ? 'no_validated_catalog_code_available' : 'catalog_code_present',
    classificationSource: confirmed ? input.precision.classificationSource : null,
    classificationConfidence: confirmed ? input.precision.subindustryConfidence : null,
    provenance: input.provenance,
    precision: input.precision,
  };
}

// ─── Proyección a metadata ────────────────────────────────────────────────────

/** Clave bajo la que la captura aterriza en `prospect_candidates.metadata`. */
export const APOLLO_ENRICHMENT_PERSISTENCE_METADATA_KEY = 'apollo_enrichment_capture' as const;

/**
 * Bloque estructurado para la metadata del candidato.
 *
 * Aquí viven la evidencia y la procedencia que `prospect_candidates` no tiene
 * columnas para guardar. Las columnas normales NO se sustituyen por esto: se
 * escriben además, que es lo que el § 4 exige.
 */
export function toApolloEnrichmentPersistenceMetadata(
  capture: ApolloEnrichmentPersistenceCapture,
): Record<string, unknown> {
  return {
    city: capture.city,
    industry: capture.industry,
    subindustry: capture.subindustry,
    sector_code: capture.sectorCode,
    sector_code_reason: capture.sectorCodeReason,
    classification_source: capture.classificationSource,
    classification_confidence: capture.classificationConfidence,
    provenance: {
      source_provider: capture.provenance.sourceProvider,
      source_operation: capture.provenance.sourceOperation,
      source_request_id: capture.provenance.sourceRequestId,
      observed_at: capture.provenance.observedAt,
    },
    precision: toApolloSubindustryPrecisionMetadata(capture.precision),
  };
}

// ─── Proyección a columnas ────────────────────────────────────────────────────

/**
 * Columnas de `prospect_candidates` que la captura puede rellenar.
 *
 * Se devuelve un objeto PARCIAL a propósito: una clave ausente deja la columna
 * como estaba, mientras que una clave con `null` la sobrescribiría con nada. Un
 * dato que el proveedor no devolvió no debe borrar uno que ya estuviera.
 */
/**
 * Dominio que la CHECK `prospect_candidates_classification_source_check`
 * (migración 093) admite en la columna homónima.
 */
export const PROSPECT_CANDIDATE_CLASSIFICATION_SOURCES = [
  'writer',
  'derived_metadata',
  'derived_source_primary',
  'derived_review_notes',
  'derived_batch',
  'manual',
  'derived_status',
  'unknown',
] as const;

export type ProspectCandidateClassificationSource =
  (typeof PROSPECT_CANDIDATE_CLASSIFICATION_SOURCES)[number];

/**
 * La columna responde «quién produjo la clasificación persistida», y aquí la
 * produce el writer. El campo del proveedor que aportó la evidencia
 * (`provider_industry`, `website_profile`, …) es otro vocabulario y vive en
 * `metadata.apollo_enrichment_capture.classification_source`, que no tiene
 * dominio cerrado; no se pierde ni un dato al separarlos.
 *
 * Escribir el vocabulario de evidencia en la columna violaba la CHECK y hacía
 * fallar el INSERT de TODO candidato con subindustria confirmada — es decir,
 * justo de los que cuentan hacia el objetivo.
 */
const CANDIDATE_CLASSIFICATION_COLUMN_SOURCE: ProspectCandidateClassificationSource = 'writer';

export type ApolloEnrichmentCandidateColumns = {
  city?: string;
  subindustry?: string;
  sector_code?: string;
  classification_source?: ProspectCandidateClassificationSource;
  classification_confidence?: number;
};

export function toApolloEnrichmentCandidateColumns(
  capture: ApolloEnrichmentPersistenceCapture,
): ApolloEnrichmentCandidateColumns {
  return {
    ...(capture.city !== null ? { city: capture.city } : {}),
    ...(capture.subindustry !== null ? { subindustry: capture.subindustry } : {}),
    ...(capture.sectorCode !== null ? { sector_code: capture.sectorCode } : {}),
    ...(capture.classificationSource !== null
      ? { classification_source: CANDIDATE_CLASSIFICATION_COLUMN_SOURCE }
      : {}),
    ...(capture.classificationConfidence !== null
      ? { classification_confidence: capture.classificationConfidence }
      : {}),
  };
}
