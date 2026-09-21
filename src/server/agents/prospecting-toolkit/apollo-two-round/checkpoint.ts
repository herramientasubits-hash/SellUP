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
import {
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
  type ApolloTwoRoundDiscoveryConfig,
} from './config';
import {
  APOLLO_CONTRACT_MAX_PER_PAGE,
  WIZARD_APOLLO_MAX_PAGES_HARD_CAP,
} from '../apollo-organizations-pagination-budget';
import type { ApolloTwoRoundRoundMetrics } from './observability';
import type { CandidateSectorEvidenceState, FreeCandidateSignals } from './enrichment-ranking';
import type {
  CheapRejectionReason,
  SecondRoundSkippedReason,
} from './orchestrator';
import type { NormalizedOrganizationIdentity } from './seen-registry';

/** Clave bajo la que el checkpoint aterriza en `prospect_batches.metadata`. */
export const APOLLO_TWO_ROUND_CHECKPOINT_KEY = 'apollo_two_round_checkpoint' as const;

/** Versión del CONTRATO. Un checkpoint de otra versión se ignora, nunca se adivina. */
export const APOLLO_TWO_ROUND_CHECKPOINT_CONTRACT_VERSION = 1 as const;

/**
 * Techo del documento serializado.
 *
 * ─── X6.7 · por qué el techo dejó de ser 64 KiB ──────────────────────────────
 *
 * El número anterior tenía UNA premisa escrita: «64 KiB con un tope de diez
 * resultados crudos por corrida deja ~6 KiB por candidato». Esa premisa era el
 * `maxRawResultsPerRun` como AUTORIDAD DE ADMISIÓN, y
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 2 la ELIMINÓ: hoy se evalúan todas las
 * organizaciones que la página pagada devuelve, y `totalRawResults` sobrevive
 * sólo como contador observacional. El techo se quedó atrás, sin premisa, y se
 * convirtió en una trampa fail-closed sobre exactamente la forma de corrida que
 * el CORTE 2 habilitó: la E2E X6.6 devolvió 98 organizations, el checkpoint no
 * cupo y una búsqueda YA PAGADA quedó indeterminada.
 *
 * Medición que lo prueba (suite X6.7): con la evidencia de los rechazados ya
 * soltada por la etapa 1 de § 6, el estado MÍNIMO de 98 candidatos —identidad,
 * veredicto y señales, sin una sola descripción— ocupa ~103 KiB. Bajo 64 KiB el
 * sistema no podía guardar ni lo imprescindible.
 *
 * El techo se re-deriva en vez de inventarse: una corrida puede procesar como
 * máximo `rondas × páginas por ronda × organizaciones por página` = 2 × 5 × 100
 * = 1.000 organizaciones, y el estado mínimo recuperable de cada una está
 * medido en ~1 KiB. «Cabe» vuelve a ser una aserción con premisa, y la premisa
 * vuelve a estar atada a constantes reales del contrato de paginación en vez de
 * a un tope borrado.
 *
 * El techo NO sustituye a la compactación: pasado el techo, el documento se
 * compacta (§ 6) en vez de crecer, y la etapa 3 sigue acotando el payload de las
 * organizaciones pendientes, que es el único que viaja con evidencia completa.
 */
export const APOLLO_TWO_ROUND_MAX_RECOVERABLE_ORGANIZATIONS_PER_RUN =
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX * WIZARD_APOLLO_MAX_PAGES_HARD_CAP * APOLLO_CONTRACT_MAX_PER_PAGE;

/** Estado mínimo recuperable por organización, MEDIDO sin evidencia. */
export const APOLLO_TWO_ROUND_CHECKPOINT_BYTES_PER_ORGANIZATION = 1024;

export const APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES =
  APOLLO_TWO_ROUND_MAX_RECOVERABLE_ORGANIZATIONS_PER_RUN *
  APOLLO_TWO_ROUND_CHECKPOINT_BYTES_PER_ORGANIZATION;

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
 * `buildProspectingPipelineCandidate` (título, url, snippet, rank y el website
 * declarado, vía `readApolloCandidateWebsite`).
 *
 * 🔴 X6.1 — «por necesidad» sólo se sostiene si la necesidad se comprueba. El
 * trinquete de `agent1-ownership-domain-snapshot-x6-1.test.ts` fija la lista de
 * campos de `metadata` que los lectores canónicos de identidad consultan y exige
 * que cada uno sobreviva al viaje: sin él, un lector nuevo vuelve a leer un campo
 * que este documento no guarda, y el síntoma aparece tres capas más abajo.
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
  /**
   * 🔴 AGENT1-OWNERSHIP-DOMAIN-SNAPSHOT-X6.1 — el sitio web DECLARADO por Apollo.
   *
   * Faltaba, y su ausencia era la causa de que el gate obligatorio de ownership
   * rechazara a toda empresa que Apollo sí dotó de dominio. La cadena completa:
   *
   *   · el mapper del proveedor estampa el sitio en DOS sitios —`metadata.website`
   *     y `metadata.apollo_profile.website_url`—;
   *   · esta lista blanca conservaba `domain` pero NINGUNO de esos dos campos;
   *   · el runner reconstruye el resultado desde este snapshot también en la
   *     PRIMERA pasada, no sólo en un reintento;
   *   · desde #394 `buildProspectingPipelineCandidate` deriva el website de Apollo
   *     con `readApolloCandidateWebsite`, que lee EXACTAMENTE esos dos campos, y
   *     deriva el dominio del website;
   *   · resultado: `candidate.website = null` y `candidate.domain = null`, y
   *     `evaluateCompanyOwnership` recibiendo `null` responde lo único que puede
   *     responder: «No domain available to evaluate ownership».
   *
   * Medido en la certificación `cfb2acd4…`: 25 de 25 empresas evaluadas por el
   * gate, 25 bloqueadas, 0 aprobadas — y las 25 llevaban dominio válido en su
   * propia fila de `prospect_discarded_dispositions`, porque la rama de IDENTIDAD
   * (`identity.normalizedDomain`) lee el resultado original y nunca pasó por aquí.
   * Dos representaciones de la misma empresa divergiendo en un solo campo.
   *
   * 🔴 Un solo campo para las dos representaciones, a propósito: lo que el
   * contrato promete es el valor OBSERVABLE por `readApolloCandidateWebsite`, no
   * la colocación interna. La reconstrucción lo restituye en los dos sitios con
   * ese mismo valor, así que el lector responde idéntico antes y después. El
   * efecto colateral queda escrito: si el original traía `metadata.website` y un
   * `apollo_profile.website_url` DISTINTO, tras el viaje los dos valen el primero
   * —el que el lector habría devuelto—, y el segundo pierde su valor original.
   */
  website: string | null;
  /**
   * 🔴 AGENT1-STRUCTURAL-OWNERSHIP-TRANSPORT-X6.10-B — los alias de dominio que
   * Apollo declara para esta organización.
   *
   * Sin él, la lección de X6.1 se repetiría exacta: el runner reconstruye el
   * resultado desde este snapshot TAMBIÉN en la primera pasada, así que un
   * campo que no esté en la lista blanca llega al constructor como ausente y el
   * candidato queda con `providerDomainAliases: []`. La evidencia existiría en
   * la respuesta del proveedor y no existiría en el candidato — dos
   * representaciones de la misma empresa divergiendo en un solo campo.
   *
   * Opcional a propósito: los checkpoints escritos antes de este cambio no la
   * traen, y leerlos debe seguir funcionando.
   */
  domain_aliases?: string[];
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
  /**
   * A1-APOLLO-LINKEDIN-EMPLOYEES-1 — campos que el enrichment pagado añadió al
   * perfil. Sin ellos, un reintento atribuiría a la búsqueda un valor que en
   * realidad costó un crédito de `organization_enrichment`, y la procedencia
   * persistida sería falsa.
   *
   * Opcional a propósito: los checkpoints escritos antes de este cambio no la
   * traen, y leerlos debe seguir funcionando. Ausente ⇒ se asume la búsqueda.
   */
  enrichment_fields_added?: string[];
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

/**
 * X6.10-B — alias de dominio, acotados por NÚMERO y por LONGITUD.
 *
 * El tope de elementos es más bajo que `MAX_ARRAY_ELEMENTS` porque la capa que
 * los consume no acepta conjuntos mayores: transportar lo que nadie puede usar
 * sólo engorda el documento. El techo por elemento es el de DNS (63 caracteres
 * por etiqueta), no el genérico de etiqueta: un "dominio" más largo que eso no
 * es un dominio.
 */
const MAX_DOMAIN_ALIAS_ELEMENTS = 8;
const MAX_DOMAIN_ALIAS_CHARS = 63;

function truncateDomainAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim().toLowerCase().slice(0, MAX_DOMAIN_ALIAS_CHARS);
    if (trimmed === '' || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length === MAX_DOMAIN_ALIAS_ELEMENTS) break;
  }
  return out;
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
    // 🔴 X6.1 — la MISMA precedencia que `readApolloCandidateWebsite`, ni una más:
    // `metadata.website` y, si falta, `metadata.apollo_profile.website_url`.
    //
    // Deliberadamente NO usa `pick('website')`: eso añadiría un `profile.website`
    // que el lector no consulta, y una precedencia que el lector no tiene es una
    // segunda semántica esperando divergir. El campo del perfil se llama
    // `website_url`, y se lee por su nombre.
    website: truncateText(meta['website']) ?? truncateText(profile['website_url']),
    // X6.10-B — acotado por `truncateDomainAliases`: como mucho
    // `MAX_TRANSPORTED_DOMAIN_ALIASES` etiquetas de dominio, que es también el
    // techo por encima del cual la capa estructural deja de usarlas.
    domain_aliases: truncateDomainAliases(profile['all_domains']),
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
    enrichment_fields_added: truncateStringArray(meta['apollo_enrichment_fields_added']),
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
 *      originQuery y —🔴 X6.1— el website DECLARADO, que para un resultado de
 *      Apollo obtiene con `readApolloCandidateWebsite`: `metadata.website` y, si
 *      falta, `metadata.apollo_profile.website_url`. Esta línea decía «title, url,
 *      snippet, source, rank, originQuery» y punto, y era verdad hasta el #394;
 *      después el constructor empezó a leer dos campos más y esta lista no se
 *      movió. El dominio del candidato se deriva de ese website, así que la
 *      omisión llegaba hasta el gate de ownership.
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
      // 🔴 X6.1 — `readApolloCandidateWebsite` lee este campo PRIMERO, así que
      // restituirlo aquí es lo que devuelve al constructor el website que el
      // proveedor declaró. Su gemelo va abajo, en `apollo_profile.website_url`:
      // los dos, porque el lector consulta los dos y restituir sólo uno dejaría
      // el contrato dependiendo de cuál se leyó.
      // `?? null` por los checkpoints LEGACY: los documentos escritos antes de
      // X6.1 no traen la clave, y leerlos debe seguir funcionando —exactamente
      // el mismo trato que `enrichment_fields_added`. Un checkpoint antiguo
      // reconstruye sin website, como hasta ahora; uno nuevo, con él.
      website: snapshot.website ?? null,
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
      // La procedencia sobrevive al reintento: si el enrichment aportó el
      // tamaño, la reconstrucción lo sigue atribuyendo al enrichment.
      apollo_enrichment_fields_added: snapshot.enrichment_fields_added ?? [],
      apollo_profile: {
        industry: snapshot.industry,
        industries: snapshot.industries,
        keywords: snapshot.keywords,
        organization_keywords: snapshot.organization_keywords,
        short_description: snapshot.short_description,
        seo_description: snapshot.seo_description,
        description: snapshot.description,
        primary_domain: snapshot.domain,
        // 🔴 X6.10-B — `readApolloCandidateDomainAliases` lee EXACTAMENTE aquí.
        // `?? []` por los checkpoints LEGACY, igual que `enrichment_fields_added`.
        all_domains: snapshot.domain_aliases ?? [],
        // 🔴 X6.1 — el respaldo que `readApolloCandidateWebsite` consulta cuando
        // `metadata.website` falta. Mismo valor que arriba: el contrato es el que
        // el lector observa, no en cuál de los dos sitios estaba.
        website_url: snapshot.website ?? null,
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

/**
 * X6.7 — recuento por ronda de lo que la búsqueda PAGADA devolvió frente a lo
 * que el checkpoint conserva.
 *
 * Existe para que la compactación de § 6 sobre las organizaciones pendientes
 * NUNCA sea un truncado silencioso: leyendo el documento se ve que la página
 * trajo 98 organizaciones y cuántas quedaron recuperables.
 *
 * El registro completo de lo que la página devolvió sigue viviendo en
 * `provider_usage_logs.metadata.apollo_page_logs` (X6.5), que este hito no toca.
 */
export type ApolloTwoRoundPendingOrganizationTally = {
  round_number: number;
  /** Organizaciones que la búsqueda devolvió para esa ronda. */
  returned: number;
  /** Organizaciones cuyo snapshot viaja en `pending_organizations`. */
  retained: number;
};

/** Recuento por ronda de una lista de pendientes, sin nada perdido todavía. */
export function buildPendingOrganizationTallies(
  pending: readonly ApolloTwoRoundPendingOrganizationSnapshot[],
  returnedByRound: ReadonlyMap<number, number>,
): ApolloTwoRoundPendingOrganizationTally[] {
  const retainedByRound = new Map<number, number>();
  for (const entry of pending) {
    retainedByRound.set(entry.round_number, (retainedByRound.get(entry.round_number) ?? 0) + 1);
  }
  const rounds = new Set<number>([...returnedByRound.keys(), ...retainedByRound.keys()]);
  return [...rounds]
    .sort((a, b) => a - b)
    .map((roundNumber) => ({
      round_number: roundNumber,
      returned: Math.max(
        returnedByRound.get(roundNumber) ?? 0,
        retainedByRound.get(roundNumber) ?? 0,
      ),
      retained: retainedByRound.get(roundNumber) ?? 0,
    }));
}

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

/**
 * Gasto registrado de UNA operación externa, atado a su identidad económica.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-CAS-CLOSE · § 2.
 *
 * Antes el gasto de la corrida viajaba SÓLO como un escalar acumulado
 * (`spend_accounting.recorded_usage_credits`). Un escalar no se puede fusionar:
 * ante dos checkpoints concurrentes, sumarlos duplica el gasto y quedarse con el
 * mayor lo esconde. Con el gasto desglosado por `operation_id` la fusión es
 * aritmética trivial y exacta — una operación se cobró una vez, aparezca en uno o
 * en los dos documentos.
 *
 * `credits` es lo que NUESTRO ledger registró, nunca la factura de Apollo, y
 * nunca se descuenta: una operación indeterminada conserva los créditos que llegó
 * a registrar —pudo haberse cobrado— y además levanta `billing_unknown`. Las dos
 * señales son distintas y las dos hacen falta: la primera alimenta el guard de
 * presupuesto, la segunda la conciliación manual.
 */
export type ApolloTwoRoundRecordedOperationCredit = {
  operation_id: string;
  operation_key: 'organizations_search' | 'organization_enrichment';
  round_number: number;
  /** `usage_key` de la fila de `provider_usage_logs`, cuando la operación la emite. */
  usage_key: string | null;
  /** Créditos que el ledger interno registró para esta operación. Nunca negativo. */
  credits: number;
  /** True cuando el cobro real de esta operación no se pudo confirmar. */
  billing_unknown: boolean;
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
  /**
   * Corrida del wizard a la que pertenece este documento.
   *
   * CAS-CLOSE § 2: la fusión de dos checkpoints NUNCA mezcla dos `wizard_run_id`
   * distintos. `null` en documentos escritos antes de que el campo existiera; en
   * ese caso la identidad la siguen probando la clave de idempotencia y la huella.
   */
  wizard_run_id: string | null;
  config: ApolloTwoRoundDiscoveryConfig;
  completed_operation_keys: string[];
  indeterminate_operation_keys: string[];
  seen_organization_keys: string[];
  round_summaries: ApolloTwoRoundRoundMetrics[];
  candidate_snapshots: ApolloTwoRoundCandidateSnapshot[];
  /** § 5 — organizaciones pagadas y aún sin evaluar. Vacío en una corrida sana. */
  pending_organizations: ApolloTwoRoundPendingOrganizationSnapshot[];
  /**
   * X6.7 — lo que cada ronda pendiente devolvió frente a lo que se conservó.
   * Vacío cuando no hay ninguna ronda pendiente.
   */
  pending_organization_tallies: ApolloTwoRoundPendingOrganizationTally[];
  enrichment_snapshots: ApolloTwoRoundEnrichmentSnapshot[];
  /** § 2 CAS-CLOSE — gasto desglosado por operación. Fuente de la deduplicación. */
  recorded_operation_credits: ApolloTwoRoundRecordedOperationCredit[];
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
  /**
   * AGENT1-APOLLO-ROUND-EXECUTION-TIME-BUDGET § 4 — la ronda se quedó sin tiempo
   * de ejecución con organizaciones ya pagadas todavía sin evaluar.
   *
   * No es un fallo: lo evaluado es válido y las pendientes viajan en
   * `pending_organizations`. Es el tercer estado que faltaba entre «pendiente» y
   * «terminado».
   */
  | 'round_assessment_partial'
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

// La rehidratación del registro NO vive aquí: el orquestador reconstruye el
// registro de identidades desde `candidate_snapshots`, que es donde están las
// identidades completas. Un helper que sólo sabía volver de las claves planas no
// tenía llamador, y conservarlo invitaba a rehidratar desde una proyección con
// menos información que la fuente.

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
 *      (enrichment ejecutado y veredicto cerrado);
 *   3. X6.7 — organizaciones PENDIENTES por la cola del orden del proveedor.
 *
 * Nunca suelta la evidencia de un candidato elegible pendiente de persistir: sin
 * ella el reintento no podría recuperarlo y la corrida terminaría vacía después
 * de haber pagado.
 *
 * ─── Por qué la etapa 3, y por qué NO es "eliminar información necesaria" ────
 *
 * El defecto que cierra (E2E X6.6, Production): una página de 98 organizations
 * hacía que el checkpoint de `search_round_completed` llevara 98 snapshots con
 * su evidencia. El documento pasaba del techo, la escritura devolvía
 * `too_large`, y el orquestador degradaba a INDETERMINADA una búsqueda YA
 * PAGADA. Antes de X6.7 las pendientes eran intocables, así que la única salida
 * era perder la corrida entera.
 *
 * Qué NO cuesta la etapa 3: nada de la corrida en curso. Las organizaciones
 * viven en memoria mientras la corrida sigue; se evalúan TODAS, compiten TODAS y
 * se persisten igual. Lo que la cota acota es únicamente lo que un reintento
 * podría recuperar de esa ventana — y hoy ese reintento recupera CERO, porque la
 * escritura falla entera y la operación queda indeterminada. Conservar las que
 * caben es estrictamente mejor que no conservar ninguna, en todos los casos.
 *
 * Qué se conserva íntegro, y por eso la reanudación sigue siendo correcta: que la
 * operación quedó COMPLETADA, la identidad de la corrida, el gasto por operación,
 * el ledger y las métricas. Un reintento nunca vuelve a pagar la búsqueda.
 *
 * Qué payload NO pertenece al checkpoint: el de las organizaciones que no caben.
 * Se sueltan ENTERAS (identidad y evidencia juntas), nunca a medias: una
 * identidad sin evidencia haría que el reintento la evaluara como
 * `invalid_domain`, que es un veredicto que la corrida nunca alcanzó. Preferimos
 * no saber de ella a mentir sobre ella.
 *
 * Y no es silencioso: `pending_organization_tallies` publica por ronda cuántas
 * devolvió la búsqueda y cuántas quedaron, y `compacted` se levanta.
 *
 * Se sueltan por la COLA del orden del proveedor: el rango del proveedor es el
 * desempate que el propio ranking usa, así que lo primero que sobra es lo último
 * que el proveedor consideró relevante.
 *
 * Si ni siquiera el estado operativo cabe, se devuelve `withinLimit: false` y el
 * escritor lo reporta en vez de escribir un documento desmedido.
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
  if (bytes <= maxBytes) {
    return { checkpoint: current, serializedBytes: bytes, withinLimit: true, droppedEvidenceFor: dropped };
  }

  // Etapa 3 (X6.7) — recortar las organizaciones pendientes por la cola.
  current = dropPendingOrganizationsToFit(current, maxBytes);
  bytes = measureCheckpointSerializedBytes(current);
  return {
    checkpoint: current,
    serializedBytes: bytes,
    withinLimit: bytes <= maxBytes,
    droppedEvidenceFor: dropped,
  };
}

/**
 * Conserva el prefijo MÁS LARGO de organizaciones pendientes que cabe.
 *
 * Búsqueda binaria sobre el número conservado: el tamaño crece de forma monótona
 * con él, así que bastan ~log2(n) mediciones. Recortar de una en una midiendo
 * cada vez sería cuadrático sobre un documento de cientos de KiB.
 *
 * Devuelve el checkpoint intacto cuando no hay ninguna pendiente que soltar: en
 * ese caso el exceso no lo causa esta lista y fingir una compactación sólo
 * levantaría `compacted` sin haber soltado nada.
 */
function dropPendingOrganizationsToFit(
  checkpoint: ApolloTwoRoundCheckpointV1,
  maxBytes: number,
): ApolloTwoRoundCheckpointV1 {
  const pending = checkpoint.pending_organizations;
  if (pending.length === 0) return checkpoint;

  const returnedByRound = new Map<number, number>();
  for (const tally of checkpoint.pending_organization_tallies ?? []) {
    returnedByRound.set(tally.round_number, tally.returned);
  }
  for (const entry of pending) {
    const seen = returnedByRound.get(entry.round_number) ?? 0;
    if (seen === 0) returnedByRound.set(entry.round_number, 0);
  }
  // Sin recuento previo, lo devuelto es lo que hay: la compactación no puede
  // inventar un total mayor del que se le entregó.
  const fallbackReturned = new Map<number, number>();
  for (const entry of pending) {
    fallbackReturned.set(entry.round_number, (fallbackReturned.get(entry.round_number) ?? 0) + 1);
  }
  for (const [roundNumber, count] of fallbackReturned) {
    if (!returnedByRound.has(roundNumber) || (returnedByRound.get(roundNumber) ?? 0) < count) {
      returnedByRound.set(roundNumber, count);
    }
  }

  const withFirst = (keep: number): ApolloTwoRoundCheckpointV1 => {
    const kept = pending.slice(0, keep);
    return {
      ...checkpoint,
      pending_organizations: kept,
      pending_organization_tallies: buildPendingOrganizationTallies(kept, returnedByRound),
      compacted: checkpoint.compacted || keep < pending.length,
    };
  };

  // Invariante de la búsqueda: `low` siempre cabe, `high` siempre se prueba.
  let low = 0;
  let high = pending.length;
  if (measureCheckpointSerializedBytes(withFirst(0)) > maxBytes) return withFirst(0);
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (measureCheckpointSerializedBytes(withFirst(middle)) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return withFirst(low);
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
    // Ausente en documentos escritos antes de X6.7. Vacío es la lectura honesta:
    // no hay recuento que leer, y `pending_organizations` sigue siendo la fuente
    // de lo recuperable.
    pending_organization_tallies: Array.isArray(candidate.pending_organization_tallies)
      ? candidate.pending_organization_tallies
      : [],
    enrichment_snapshots: Array.isArray(candidate.enrichment_snapshots)
      ? candidate.enrichment_snapshots
      : [],
    // Ausente en documentos anteriores al desglose por operación. Vacío es la
    // lectura honesta: no hay atribución por operación que fusionar, y el escalar
    // `spend_accounting.recorded_usage_credits` sigue siendo el suelo del gasto.
    recorded_operation_credits: Array.isArray(candidate.recorded_operation_credits)
      ? candidate.recorded_operation_credits
      : [],
    wizard_run_id: typeof candidate.wizard_run_id === 'string' ? candidate.wizard_run_id : null,
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
