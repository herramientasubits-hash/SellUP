/**
 * checkpoint.ts — Estado durable MÍNIMO de una corrida de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX · § 5, § 6, § 7.
 *
 * Sustituye al `run-state` anterior, que guardaba en `prospect_batches.metadata`
 * el `ProspectingPipelineCandidate` completo y el `WebSearchResult` completo de
 * cada organización. Eso tenía dos problemas:
 *
 *   1. volcaba payloads enteros del proveedor en un JSONB compartido, con todo lo
 *      que Apollo hubiera devuelto dentro;
 *   2. crecía sin un techo declarado, así que "cabe" era una suposición.
 *
 * Aquí sólo viaja lo que un reintento NECESITA para continuar sin repetir una
 * operación pagada:
 *
 *   qué operaciones se completaron y cuáles quedaron indeterminadas
 *   qué organizaciones ya se vieron
 *   qué decidió cada gate barato sobre cada candidato, y por qué
 *   qué enrichments se ejecutaron y con qué resultado
 *   si los candidatos ya se persistieron
 *   la contabilidad de gasto de la corrida
 *
 * Lo que NO viaja, explícitamente: el `WebSearchResult` completo, el
 * `ProspectingPipelineCandidate` completo, el payload crudo de Apollo, headers,
 * secretos y cualquier dato personal. La evidencia que se conserva por candidato
 * es la lista blanca de campos SECTORIALES y de IDENTIDAD DE EMPRESA que el gate
 * sectorial y el constructor de candidatos consumen — nombre, dominio, industria,
 * palabras clave, descripciones, tamaño y ubicación. Ni teléfonos, ni personas,
 * ni contactos.
 *
 * Puro: sin I/O, sin reloj, sin env. La escritura y la lectura contra Supabase
 * viven en `checkpoint.server.ts`, que es también quien sella
 * `checkpoint_updated_at`.
 */

import type { WebSearchResult } from '../types';
import type { ApolloTwoRoundDiscoveryConfig } from './config';
import type { ApolloTwoRoundRoundMetrics } from './observability';
import type { CandidateSectorEvidenceState, FreeCandidateSignals } from './enrichment-ranking';
import type {
  CheapRejectionReason,
  SecondRoundSkippedReason,
} from './orchestrator';
import {
  createSeenOrganizationRegistry,
  type NormalizedOrganizationIdentity,
  type SeenOrganizationRegistry,
} from './seen-registry';

/** Clave bajo la que el checkpoint aterriza en `prospect_batches.metadata`. */
export const APOLLO_TWO_ROUND_CHECKPOINT_KEY = 'apollo_two_round_checkpoint' as const;

/** Versión del CONTRATO. Un checkpoint de otra versión se ignora, nunca se adivina. */
export const APOLLO_TWO_ROUND_CHECKPOINT_CONTRACT_VERSION = 1 as const;

/**
 * Techo del documento serializado.
 *
 * 64 KiB con un tope de diez resultados crudos por corrida deja ~6 KiB por
 * candidato, muy por encima de lo que la lista blanca puede ocupar con sus
 * truncados. Existe para que "cabe" sea una aserción y no una esperanza: pasado
 * el techo, el checkpoint se compacta (§ 6) en vez de crecer.
 */
export const APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES = 64 * 1024;

/** Mismos truncados que la sanitización del cascade, para no divergir. */
const MAX_TEXT_CHARS = 300;
const MAX_ARRAY_ELEMENTS = 10;
/**
 * Techo por elemento de las listas de señales (industrias, palabras clave).
 *
 * Más corto que `MAX_TEXT_CHARS` a propósito: son etiquetas, no prosa, y con el
 * techo largo diez candidatos × tres listas × diez elementos bastaban para
 * duplicar el tamaño del documento entero sin aportar una sola señal más.
 */
const MAX_LABEL_CHARS = 60;

// ─── Evidencia mínima por candidato ───────────────────────────────────────────

/**
 * Los ÚNICOS campos del resultado de búsqueda que se conservan.
 *
 * Elegidos por necesidad, no por conveniencia: son los que consume
 * `evaluateApolloSectorRelevanceForPaidOperation` (evidencia sectorial),
 * `evaluateApolloEnrichmentEligibility` (país, dominio, plataforma) y
 * `buildProspectingPipelineCandidate` (título, url, snippet, rank).
 */
export type ApolloTwoRoundCandidateEvidenceSnapshot = {
  title: string;
  url: string;
  snippet: string | null;
  rank: number;
  source: string | null;
  origin_query: string | null;
  provider_organization_id: string | null;
  domain: string | null;
  linkedin_url: string | null;
  industry: string | null;
  industries: string[];
  keywords: string[];
  organization_keywords: string[];
  short_description: string | null;
  seo_description: string | null;
  description: string | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  employee_count: number | null;
};

function truncateText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_TEXT_CHARS ? trimmed.slice(0, MAX_TEXT_CHARS) : trimmed;
}

/**
 * Igual que `truncateText` pero con el techo de etiqueta.
 *
 * Se aplica a industria, ciudad y país: son valores de catálogo, no prosa. Un
 * "país" de 300 caracteres no es un país, y guardarlo así sólo infla el documento.
 */
function truncateLabel(value: unknown): string | null {
  const text = truncateText(value);
  return text === null ? null : text.slice(0, MAX_LABEL_CHARS);
}

function truncateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    .map((entry) => entry.trim().slice(0, MAX_LABEL_CHARS))
    .slice(0, MAX_ARRAY_ELEMENTS);
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Proyecta un resultado de búsqueda a su evidencia mínima.
 *
 * Lee de `metadata` y de `metadata.apollo_profile` con esa precedencia (el perfil
 * enriquecido rellena lo que la búsqueda no trajo) y descarta todo lo demás. Un
 * campo que no está en la lista blanca no llega al documento, aunque el proveedor
 * lo haya devuelto.
 */
export function toCandidateEvidenceSnapshot(
  result: WebSearchResult,
): ApolloTwoRoundCandidateEvidenceSnapshot {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const profile = (meta['apollo_profile'] ?? {}) as Record<string, unknown>;
  const pick = (key: string): unknown => meta[key] ?? profile[key];

  return {
    title: typeof result.title === 'string' ? result.title.slice(0, MAX_TEXT_CHARS) : '',
    url: typeof result.url === 'string' ? result.url.slice(0, MAX_TEXT_CHARS) : '',
    snippet: truncateText(result.snippet),
    rank: readNumber(result.rank) ?? 0,
    source: typeof result.source === 'string' ? result.source : null,
    origin_query: truncateText((result as { originQuery?: unknown }).originQuery),
    provider_organization_id:
      truncateText(meta['apollo_organization_id']) ?? truncateText(meta['organization_id']),
    domain: truncateText(pick('domain')) ?? truncateText(profile['primary_domain']),
    linkedin_url: truncateText(pick('linkedin_url')),
    industry: truncateLabel(pick('industry')),
    industries: truncateStringArray(pick('industries')),
    keywords: truncateStringArray(pick('keywords')),
    organization_keywords: truncateStringArray(pick('organization_keywords')),
    short_description: truncateText(pick('short_description')),
    seo_description: truncateText(pick('seo_description')),
    description: truncateText(pick('description')),
    city: truncateLabel(pick('city')),
    country: truncateLabel(pick('country')),
    country_code: truncateLabel(pick('country_code')),
    employee_count: readNumber(pick('employee_count') ?? pick('estimated_num_employees')),
  };
}

/**
 * Reconstruye el resultado de búsqueda que las funciones gratuitas necesitan.
 *
 * NO pretende ser el resultado original: es el mínimo con el que el gate
 * sectorial y el constructor de candidatos vuelven a decidir lo mismo. Ninguna
 * de las dos funciones consulta al proveedor, así que reconstruir aquí no cuesta
 * un crédito — es justo lo que permite no repetir la búsqueda en un reintento.
 *
 * La lista blanca cubre TODOS los campos que las tres funciones leen hoy:
 *   `evaluateApolloEnrichmentEligibility` → url, title, metadata.domain,
 *      metadata.country_code, metadata.country
 *   `evaluateApolloSectorRelevanceForPaidOperation` → metadata.industry,
 *      industries, keywords, organization_keywords, short_description,
 *      seo_description, description, employee_count, domain, y los mismos dentro
 *      de metadata.apollo_profile
 *   `buildProspectingPipelineCandidate` → title, url, snippet, source, rank,
 *      originQuery
 *
 * El adaptador usa esta reconstrucción TAMBIÉN en la primera pasada, no sólo en
 * un reintento. Es deliberado: así el veredicto de un reintento se calcula sobre
 * exactamente la misma entrada que el del primer intento, y una recuperación no
 * puede diferir del original por un campo que el checkpoint no guardaba.
 */
export function fromCandidateEvidenceSnapshot(
  snapshot: ApolloTwoRoundCandidateEvidenceSnapshot,
): WebSearchResult {
  return {
    title: snapshot.title,
    url: snapshot.url,
    snippet: snapshot.snippet,
    source: (snapshot.source ?? 'apollo_organizations') as WebSearchResult['source'],
    rank: snapshot.rank,
    provider: 'apollo_organizations',
    ...(snapshot.origin_query !== null ? { originQuery: snapshot.origin_query } : {}),
    metadata: {
      apollo_organization_id: snapshot.provider_organization_id,
      domain: snapshot.domain,
      linkedin_url: snapshot.linkedin_url,
      industry: snapshot.industry,
      industries: snapshot.industries,
      keywords: snapshot.keywords,
      organization_keywords: snapshot.organization_keywords,
      short_description: snapshot.short_description,
      seo_description: snapshot.seo_description,
      description: snapshot.description,
      city: snapshot.city,
      country: snapshot.country,
      country_code: snapshot.country_code,
      employee_count: snapshot.employee_count,
      estimated_num_employees: snapshot.employee_count,
      apollo_profile: {
        industry: snapshot.industry,
        industries: snapshot.industries,
        keywords: snapshot.keywords,
        organization_keywords: snapshot.organization_keywords,
        short_description: snapshot.short_description,
        seo_description: snapshot.seo_description,
        description: snapshot.description,
        primary_domain: snapshot.domain,
        linkedin_url: snapshot.linkedin_url,
        // Las dos formas del tamaño: el gate sectorial lee `employee_count` y el
        // resto del pipeline `estimated_num_employees`. Reconstruir sólo una
        // haría que el veredicto dependiera de por qué camino se llegó.
        employee_count: snapshot.employee_count,
        estimated_num_employees: snapshot.employee_count,
      },
    },
  } as WebSearchResult;
}

// ─── Snapshot por candidato ───────────────────────────────────────────────────

/** Estado del enrichment de un candidato. Cuatro valores, ninguno ambiguo. */
export type ApolloTwoRoundEnrichmentStatus =
  | 'not_attempted'
  | 'executed'
  | 'no_match'
  | 'indeterminate';

/** Señales gratuitas del ranking, sin las claves que el orquestador recalcula. */
export type ApolloTwoRoundRankingSignalsSnapshot = Omit<
  FreeCandidateSignals,
  'candidateKey' | 'roundNumber' | 'providerRank' | 'sectorEvidenceState'
>;

export type ApolloTwoRoundCandidateSnapshot = {
  candidate_key: string;
  round_number: number;
  provider_rank: number;
  provider_organization_id: string | null;
  normalized_name: string | null;
  normalized_domain: string | null;
  normalized_linkedin_url: string | null;
  sector_evidence_state: CandidateSectorEvidenceState;
  rejection_reason: CheapRejectionReason | null;
  eligible: boolean;
  became_eligible_after_enrichment: boolean;
  finally_rejected_or_duplicated: boolean;
  no_prior_suggestion: boolean;
  enrichment_status: ApolloTwoRoundEnrichmentStatus;
  ranking_signals: ApolloTwoRoundRankingSignalsSnapshot;
  /**
   * Evidencia mínima. `null` cuando el candidato ya está rechazado y no puede
   * volver a competir: en ese caso reconstruirlo no aporta nada y ocupa espacio
   * que un candidato vivo puede necesitar (§ 6, compactación).
   */
  evidence: ApolloTwoRoundCandidateEvidenceSnapshot | null;
};

/**
 * Organización que una búsqueda YA PAGADA devolvió y cuya evaluación barata no
 * llegó a registrarse (§ 5).
 *
 * Es la ventana entre "la búsqueda se completó" y "la ronda quedó evaluada". Sin
 * esto, un reintento dentro de esa ventana daba la ronda por vacía: la búsqueda
 * marcada como completada —correctamente, se pagó— y cero candidatos. Con esto, el
 * reintento recupera lo que la búsqueda trajo y sólo repite la evaluación, que no
 * cuesta un crédito.
 */
export type ApolloTwoRoundPendingOrganizationSnapshot = {
  round_number: number;
  provider_rank: number;
  provider_organization_id: string | null;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  declared_industry: string | null;
  /** Evidencia mínima, la misma lista blanca que los candidatos evaluados. */
  evidence: ApolloTwoRoundCandidateEvidenceSnapshot;
};

export type ApolloTwoRoundEnrichmentSnapshot = {
  candidate_key: string;
  round_number: number;
  operation_id: string;
  operation_subject: string;
  status: ApolloTwoRoundEnrichmentStatus;
  /** Créditos que NUESTRO ledger registró. `null` cuando quedó indeterminado. */
  recorded_credits: number | null;
  sector_evidence_state: CandidateSectorEvidenceState;
};

// ─── El checkpoint ────────────────────────────────────────────────────────────

export type ApolloTwoRoundCheckpointV1 = {
  version: typeof APOLLO_TWO_ROUND_CHECKPOINT_CONTRACT_VERSION;
  /**
   * Contador monótono de escrituras. Es el control optimista: un checkpoint con
   * versión menor que la almacenada NO puede sobrescribirla (§ 7).
   */
  checkpoint_version: number;
  /** Sello informativo. No participa en ninguna decisión ni en ninguna identidad. */
  checkpoint_updated_at: string | null;
  /** Qué transición produjo esta escritura. Vocabulario estático. */
  checkpoint_reason: ApolloTwoRoundCheckpointReason;
  /**
   * Identidad de la corrida. Un checkpoint cuya identidad no coincide pertenece a
   * OTRO trabajo, y reutilizarlo saltaría operaciones que nunca se hicieron.
   */
  idempotency_key: string;
  request_fingerprint: string;
  config: ApolloTwoRoundDiscoveryConfig;
  completed_operation_keys: string[];
  indeterminate_operation_keys: string[];
  seen_organization_keys: string[];
  round_summaries: ApolloTwoRoundRoundMetrics[];
  candidate_snapshots: ApolloTwoRoundCandidateSnapshot[];
  /** § 5 — organizaciones pagadas y aún sin evaluar. Vacío en una corrida sana. */
  pending_organizations: ApolloTwoRoundPendingOrganizationSnapshot[];
  enrichment_snapshots: ApolloTwoRoundEnrichmentSnapshot[];
  persisted_candidate_ids: string[];
  candidates_persisted: boolean;
  observed_rejection_reasons: CheapRejectionReason[];
  second_round_skipped_reason: SecondRoundSkippedReason | null;
  totals: {
    raw_results: number;
    search_credits: number;
    enrichment_credits: number;
    enrichments_executed: number;
  };
  spend_accounting: {
    estimated_credits: number;
    reserved_credits: number;
    recorded_usage_credits: number;
    /** NUNCA se infiere del ledger interno. */
    confirmed_provider_credits: number | null;
  };
  /** Checkpoints que no se pudieron persistir. Vacío en una corrida sana. */
  checkpoint_write_failures: string[];
  /** True cuando alguna operación exige conciliación manual. */
  manual_reconciliation_required: boolean;
  /** Evidencia que la compactación tuvo que soltar para caber (§ 6). */
  compacted: boolean;
};

export type ApolloTwoRoundCheckpointReason =
  | 'search_round_completed'
  | 'search_round_indeterminate'
  | 'round_assessment_completed'
  | 'enrichment_completed'
  | 'enrichment_indeterminate'
  | 'run_completed'
  | 'candidates_persisted';

// ─── Registro de identidades vistas ───────────────────────────────────────────

const SEEN_KEY_PREFIX = {
  providerOrganizationId: 'oid:',
  normalizedDomain: 'dom:',
  normalizedLinkedInUrl: 'lin:',
  canonicalName: 'nam:',
} as const;

/** Proyecta identidades normalizadas a claves planas y deduplicadas. */
export function toSeenOrganizationKeys(
  identities: readonly NormalizedOrganizationIdentity[],
): string[] {
  const keys = new Set<string>();
  for (const identity of identities) {
    if (identity.providerOrganizationId !== null) {
      keys.add(`${SEEN_KEY_PREFIX.providerOrganizationId}${identity.providerOrganizationId}`);
    }
    if (identity.normalizedDomain !== null) {
      keys.add(`${SEEN_KEY_PREFIX.normalizedDomain}${identity.normalizedDomain}`);
    }
    if (identity.normalizedLinkedInUrl !== null) {
      keys.add(`${SEEN_KEY_PREFIX.normalizedLinkedInUrl}${identity.normalizedLinkedInUrl}`);
    }
    if (identity.canonicalName !== null) {
      keys.add(`${SEEN_KEY_PREFIX.canonicalName}${identity.canonicalName}`);
    }
  }
  return [...keys].sort();
}

/** Rehidrata el registro desde las claves planas. */
export function fromSeenOrganizationKeys(
  keys: readonly string[],
): SeenOrganizationRegistry {
  const registry = createSeenOrganizationRegistry();
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const value = key.slice(4);
    if (value === '') continue;
    if (key.startsWith(SEEN_KEY_PREFIX.providerOrganizationId)) {
      registry.providerOrganizationIds.add(value);
    } else if (key.startsWith(SEEN_KEY_PREFIX.normalizedDomain)) {
      registry.normalizedDomains.add(value);
    } else if (key.startsWith(SEEN_KEY_PREFIX.normalizedLinkedInUrl)) {
      registry.normalizedLinkedInUrls.add(value);
    } else if (key.startsWith(SEEN_KEY_PREFIX.canonicalName)) {
      registry.canonicalNames.add(value);
    }
  }
  return registry;
}

// ─── Tamaño y compactación (§ 6) ──────────────────────────────────────────────

export function measureCheckpointSerializedBytes(
  checkpoint: ApolloTwoRoundCheckpointV1,
): number {
  return Buffer.byteLength(JSON.stringify(checkpoint), 'utf8');
}

export type CheckpointCompactionResult = {
  checkpoint: ApolloTwoRoundCheckpointV1;
  serializedBytes: number;
  withinLimit: boolean;
  droppedEvidenceFor: string[];
};

/**
 * Deja el checkpoint por debajo del techo soltando evidencia que ya no puede
 * hacer falta.
 *
 * Orden de sacrificio, del dato más inútil al más útil:
 *   1. evidencia de candidatos ya rechazados definitivamente;
 *   2. evidencia de candidatos que ya no pueden competir por un enrichment
 *      (enrichment ejecutado y veredicto cerrado).
 *
 * Nunca suelta la evidencia de un candidato elegible pendiente de persistir, ni la
 * de una organización pagada y aún sin evaluar: sin ellas el reintento no podría
 * recuperarlas y la corrida terminaría vacía después de haber pagado, que es
 * exactamente el defecto que el checkpoint existe para evitar. Si aun así no cabe,
 * se devuelve `withinLimit: false` y el escritor lo reporta en vez de escribir un
 * documento desmedido.
 */
export function compactCheckpointForSize(
  checkpoint: ApolloTwoRoundCheckpointV1,
  maxBytes: number = APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
): CheckpointCompactionResult {
  let current = checkpoint;
  let bytes = measureCheckpointSerializedBytes(current);
  const dropped: string[] = [];
  if (bytes <= maxBytes) {
    return { checkpoint: current, serializedBytes: bytes, withinLimit: true, droppedEvidenceFor: [] };
  }

  const dropEvidenceWhere = (
    predicate: (snapshot: ApolloTwoRoundCandidateSnapshot) => boolean,
  ): void => {
    const snapshots = current.candidate_snapshots.map((snapshot) => {
      if (snapshot.evidence === null || !predicate(snapshot)) return snapshot;
      dropped.push(snapshot.candidate_key);
      return { ...snapshot, evidence: null };
    });
    current = { ...current, candidate_snapshots: snapshots, compacted: true };
    bytes = measureCheckpointSerializedBytes(current);
  };

  dropEvidenceWhere((snapshot) => snapshot.finally_rejected_or_duplicated || !snapshot.eligible);
  if (bytes <= maxBytes) {
    return { checkpoint: current, serializedBytes: bytes, withinLimit: true, droppedEvidenceFor: dropped };
  }

  dropEvidenceWhere((snapshot) => snapshot.enrichment_status !== 'not_attempted');
  return {
    checkpoint: current,
    serializedBytes: bytes,
    withinLimit: bytes <= maxBytes,
    droppedEvidenceFor: dropped,
  };
}

// ─── Validación de lectura ────────────────────────────────────────────────────

/**
 * Acepta un checkpoint sólo si es de esta versión y de ESTA corrida.
 *
 * Fallar hacia "empezar de cero" es seguro para la CALIDAD (se vuelve a buscar) y
 * caro; aceptar un checkpoint ajeno sería inseguro para el GASTO, porque saltaría
 * operaciones que esta corrida nunca ejecutó. Entre las dos, la segunda.
 */
export function readCheckpoint(
  raw: unknown,
  identity: { idempotencyKey: string; requestFingerprint: string },
): ApolloTwoRoundCheckpointV1 | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ApolloTwoRoundCheckpointV1>;

  if (candidate.version !== APOLLO_TWO_ROUND_CHECKPOINT_CONTRACT_VERSION) return null;
  if (candidate.idempotency_key !== identity.idempotencyKey) return null;
  if (candidate.request_fingerprint !== identity.requestFingerprint) return null;
  if (!Array.isArray(candidate.completed_operation_keys)) return null;
  if (!Array.isArray(candidate.candidate_snapshots)) return null;
  if (!Array.isArray(candidate.round_summaries)) return null;

  return {
    ...(candidate as ApolloTwoRoundCheckpointV1),
    checkpoint_version: readNumber(candidate.checkpoint_version) ?? 0,
    indeterminate_operation_keys: Array.isArray(candidate.indeterminate_operation_keys)
      ? candidate.indeterminate_operation_keys
      : [],
    seen_organization_keys: Array.isArray(candidate.seen_organization_keys)
      ? candidate.seen_organization_keys
      : [],
    pending_organizations: Array.isArray(candidate.pending_organizations)
      ? candidate.pending_organizations
      : [],
    enrichment_snapshots: Array.isArray(candidate.enrichment_snapshots)
      ? candidate.enrichment_snapshots
      : [],
    persisted_candidate_ids: Array.isArray(candidate.persisted_candidate_ids)
      ? candidate.persisted_candidate_ids
      : [],
    candidates_persisted: candidate.candidates_persisted === true,
    observed_rejection_reasons: Array.isArray(candidate.observed_rejection_reasons)
      ? candidate.observed_rejection_reasons
      : [],
    checkpoint_write_failures: Array.isArray(candidate.checkpoint_write_failures)
      ? candidate.checkpoint_write_failures
      : [],
    manual_reconciliation_required: candidate.manual_reconciliation_required === true,
    compacted: candidate.compacted === true,
  };
}
