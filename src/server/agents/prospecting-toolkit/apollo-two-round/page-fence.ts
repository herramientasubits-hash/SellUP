/**
 * page-fence.ts — Valla durable de página, previa al envío, para la búsqueda
 * paginada de Apollo Organization Search.
 *
 * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING · PARTE B.
 *
 * Antes de este corte, `ApolloPageLedger` (en `apollo-organizations-
 * pagination-budget.ts`) sólo vivía en memoria, dentro de UNA llamada a
 * `runApolloOrganizationsPaginatedSearch`. Con la paginación net-new realmente
 * conectada, una ronda puede pedir hasta `WIZARD_APOLLO_MAX_PAGES_HARD_CAP`
 * páginas —cada una, un crédito de Apollo—, y si el proceso muere a mitad de
 * esa llamada, ningún checkpoint de ronda llega a escribirse: al reintentar,
 * el orquestador no sabe que esas páginas ya se pidieron y puede volver a
 * pagarlas.
 *
 * Este módulo es una valla DELIBERADAMENTE separada del checkpoint de ronda
 * (`checkpoint.ts`): ese documento necesita el estado COMPLETO del
 * orquestador (candidatos, rondas, dedup) para escribirse, y ese estado no
 * existe todavía a mitad de una búsqueda multi-página. La valla de página sólo
 * necesita saber, por página, si ya se pidió y qué trajo — y sólo mientras esa
 * ronda sigue en vuelo: en cuanto la ronda se cierra (con éxito o
 * indeterminada) sus entradas se limpian (`clearApolloPageFenceRound`), porque
 * a partir de ahí el checkpoint de ronda YA es la fuente de verdad.
 *
 * Puro: sin I/O, sin reloj, sin env. La lectura/escritura contra Supabase vive
 * en `page-fence.server.ts`.
 *
 * Ni teléfonos, ni personas, ni contactos viajan aquí — la misma disciplina de
 * `checkpoint.ts`: sólo la evidencia de identidad/sector de la organización.
 */

import type { NormalizedApolloOrganization } from '../apollo-organizations-response-normalizer';
import type {
  ApolloDurableResumeState,
  ApolloPaginatedSearchDeps,
} from '../apollo-organizations-paginated-search';

/** Clave bajo la que la valla aterriza en `prospect_batches.metadata`. */
export const APOLLO_PAGE_FENCE_METADATA_KEY = 'apollo_two_round_page_fence' as const;

/** Versión del CONTRATO. Un documento de otra versión se ignora, nunca se adivina. */
export const APOLLO_PAGE_FENCE_CONTRACT_VERSION = 1 as const;

/**
 * Techo del documento serializado. Deliberadamente más chico que el del
 * checkpoint de ronda (64 KiB): esta valla es ESCRATCH transitorio de UNA
 * ronda en vuelo, nunca el acumulado de la corrida entera.
 */
export const APOLLO_PAGE_FENCE_MAX_SERIALIZED_BYTES = 32 * 1024;

const MAX_TEXT_CHARS = 300;
const MAX_ARRAY_ELEMENTS = 10;
const MAX_LABEL_CHARS = 60;

// ─── Organización slim ────────────────────────────────────────────────────────

/**
 * Los ÚNICOS campos de `NormalizedApolloOrganization` que la valla conserva.
 *
 * Misma lista blanca que `ApolloTwoRoundCandidateEvidenceSnapshot`
 * (checkpoint.ts) menos los campos que no existen en esta forma (title/url/
 * snippet/rank son del `WebSearchResult`, no de la organización normalizada) y
 * menos `phone`/`foundedYear`: el propio checkpoint de ronda ya los excluye, y
 * esta valla no inventa una lista blanca más permisiva que la que YA rige la
 * durabilidad de la corrida.
 */
export type ApolloPageFenceOrganization = {
  provider_organization_id: string;
  name: string | null;
  primary_domain: string | null;
  normalized_domains: string[];
  website_url: string | null;
  linkedin_url: string | null;
  industry: string | null;
  industries: string[];
  keywords: string[];
  organization_keywords: string[];
  estimated_num_employees: number | null;
  city: string | null;
  country: string | null;
  short_description: string | null;
  seo_description: string | null;
  description: string | null;
};

function truncateText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_TEXT_CHARS ? trimmed.slice(0, MAX_TEXT_CHARS) : trimmed;
}

function truncateLabels(values: readonly string[]): string[] {
  return values
    .slice(0, MAX_ARRAY_ELEMENTS)
    .map((value) => value.trim().slice(0, MAX_LABEL_CHARS))
    .filter((value) => value.length > 0);
}

/** Convierte una organización normalizada a la forma slim y durable de la valla. */
export function toApolloPageFenceOrganization(
  organization: NormalizedApolloOrganization,
): ApolloPageFenceOrganization {
  return {
    provider_organization_id: organization.providerReference.providerOrganizationId,
    name: truncateText(organization.name),
    primary_domain: truncateText(organization.primaryDomain),
    normalized_domains: truncateLabels(organization.normalizedDomains),
    website_url: truncateText(organization.websiteUrl),
    linkedin_url: truncateText(organization.linkedinUrl),
    industry: truncateText(organization.industry),
    industries: truncateLabels(organization.industries),
    keywords: truncateLabels(organization.keywords),
    organization_keywords: truncateLabels(organization.organizationKeywords),
    estimated_num_employees:
      typeof organization.estimatedNumEmployees === 'number'
        ? organization.estimatedNumEmployees
        : null,
    city: truncateText(organization.city),
    country: truncateText(organization.country),
    short_description: truncateText(organization.shortDescription),
    seo_description: truncateText(organization.seoDescription),
    description: truncateText(organization.description),
  };
}

/**
 * Reconstruye una `NormalizedApolloOrganization` a partir de la forma slim.
 *
 * Los campos que la valla no conserva (`phone`, `foundedYear`,
 * `filledFromAccountFields`) vuelven en su valor neutro: exactamente lo que ya
 * tolera el resto del pipeline para organizaciones sin ese dato.
 */
export function fromApolloPageFenceOrganization(
  slim: ApolloPageFenceOrganization,
): NormalizedApolloOrganization {
  return {
    providerReference: {
      provider: 'apollo',
      providerOrganizationId: slim.provider_organization_id,
      providerAccountId: null,
    },
    name: slim.name,
    primaryDomain: slim.primary_domain,
    normalizedDomains: slim.normalized_domains,
    websiteUrl: slim.website_url,
    linkedinUrl: slim.linkedin_url,
    phone: null,
    foundedYear: null,
    country: slim.country,
    city: slim.city,
    industry: slim.industry,
    industries: slim.industries,
    keywords: slim.keywords,
    organizationKeywords: slim.organization_keywords,
    estimatedNumEmployees: slim.estimated_num_employees,
    shortDescription: slim.short_description,
    seoDescription: slim.seo_description,
    description: slim.description,
    technologies: [],
    filledFromAccountFields: [],
  };
}

// ─── Entradas y documento ──────────────────────────────────────────────────────

export type ApolloPageFenceStatus = 'request_started' | 'succeeded' | 'indeterminate';

export type ApolloPageFenceEntry = {
  round_number: number;
  search_plan_fingerprint: string;
  page: number;
  status: ApolloPageFenceStatus;
  /** `[]` para `request_started`/`indeterminate`. */
  organizations: ApolloPageFenceOrganization[];
  credits: number;
  results_returned: number;
  total_pages: number | null;
  accepted_count: number | null;
};

export type ApolloPageFenceDocumentV1 = {
  version: typeof APOLLO_PAGE_FENCE_CONTRACT_VERSION;
  /** Contador monótono de escrituras. Mismo control optimista que el checkpoint. */
  fence_version: number;
  /** Identidad de la corrida. Un documento cuya identidad no coincide pertenece a OTRO trabajo. */
  idempotency_key: string;
  request_fingerprint: string;
  entries: ApolloPageFenceEntry[];
  /** Evidencia que la compactación tuvo que soltar para caber. */
  compacted: boolean;
};

function entryKey(entry: Pick<ApolloPageFenceEntry, 'round_number' | 'search_plan_fingerprint' | 'page'>): string {
  return `${entry.round_number}:${entry.search_plan_fingerprint}:${entry.page}`;
}

const STATUS_RANK: Record<ApolloPageFenceStatus, number> = {
  request_started: 0,
  indeterminate: 1,
  succeeded: 2,
};

/**
 * Decide cuál de dos entradas para la MISMA página conservar.
 *
 * `succeeded` > `indeterminate` > `request_started`: un desenlace terminal es
 * siempre más informativo que su ausencia, y un desenlace indeterminado nunca
 * se descarta en favor de un simple "se intentó" más nuevo — perdería la única
 * señal de que esa página pudo haberse cobrado sin resolverse.
 */
function pickBetterEntry(a: ApolloPageFenceEntry, b: ApolloPageFenceEntry): ApolloPageFenceEntry {
  return STATUS_RANK[b.status] >= STATUS_RANK[a.status] ? b : a;
}

/**
 * Une dos listas de entradas, quedándose con la más informativa por clave
 * (ronda + huella + página). Determinista y conmutativo: fusionar A sobre B da
 * el mismo resultado que B sobre A.
 */
export function mergeApolloPageFenceEntries(
  base: readonly ApolloPageFenceEntry[],
  incoming: readonly ApolloPageFenceEntry[],
): ApolloPageFenceEntry[] {
  const byKey = new Map<string, ApolloPageFenceEntry>();
  for (const entry of base) byKey.set(entryKey(entry), entry);
  for (const entry of incoming) {
    const existing = byKey.get(entryKey(entry));
    byKey.set(entryKey(entry), existing ? pickBetterEntry(existing, entry) : entry);
  }
  return [...byKey.values()].sort((a, b) =>
    a.round_number !== b.round_number ? a.round_number - b.round_number : a.page - b.page,
  );
}

/** Quita todas las entradas de UNA ronda. Se llama cuando esa ronda ya cerró. */
export function clearApolloPageFenceRound(
  entries: readonly ApolloPageFenceEntry[],
  roundNumber: number,
): ApolloPageFenceEntry[] {
  return entries.filter((entry) => entry.round_number !== roundNumber);
}

// ─── Lectura validada ──────────────────────────────────────────────────────────

/**
 * Valida un valor crudo de `metadata` como documento de valla de ESTA corrida.
 *
 * Rechaza (devuelve `null`, nunca adivina):
 *   - versión de contrato distinta,
 *   - identidad (`idempotency_key`/`request_fingerprint`) que no coincide: un
 *     documento de OTRA corrida no puede prestar sus páginas a ésta.
 */
export function readApolloPageFenceDocument(
  raw: unknown,
  identity: { idempotencyKey: string; requestFingerprint: string },
): ApolloPageFenceDocumentV1 | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== APOLLO_PAGE_FENCE_CONTRACT_VERSION) return null;
  if (candidate.idempotency_key !== identity.idempotencyKey) return null;
  if (candidate.request_fingerprint !== identity.requestFingerprint) return null;
  if (typeof candidate.fence_version !== 'number' || !Number.isFinite(candidate.fence_version)) {
    return null;
  }
  if (!Array.isArray(candidate.entries)) return null;

  return {
    version: APOLLO_PAGE_FENCE_CONTRACT_VERSION,
    fence_version: candidate.fence_version,
    idempotency_key: identity.idempotencyKey,
    request_fingerprint: identity.requestFingerprint,
    entries: candidate.entries as ApolloPageFenceEntry[],
    compacted: candidate.compacted === true,
  };
}

// ─── Compactación por tamaño ───────────────────────────────────────────────────

/**
 * Si el documento excede el techo, vacía `organizations` de las entradas
 * `succeeded` (empezando por la de MÁS organizaciones) hasta caber, marcando
 * `compacted: true`.
 *
 * El `page` y el `status` de la entrada NUNCA se tocan: eso es lo que
 * garantiza que una página compactada siga sin poder re-pedirse. Lo único que
 * se pierde, en el peor caso, son las organizaciones de esa página concreta —
 * el reintento las tratará como si esa página hubiera vuelto vacía en cuanto a
 * candidatos recuperables, nunca como si no se hubiera pedido.
 */
export function compactApolloPageFenceForSize(
  document: ApolloPageFenceDocumentV1,
  maxBytes: number,
): { document: ApolloPageFenceDocumentV1; serializedBytes: number; withinLimit: boolean } {
  let working = document;
  let serializedBytes = Buffer.byteLength(JSON.stringify(working), 'utf8');
  if (serializedBytes <= maxBytes) {
    return { document: working, serializedBytes, withinLimit: true };
  }

  const order = [...working.entries]
    .map((entry, index) => ({ index, size: entry.organizations.length }))
    .filter((item) => item.size > 0)
    .sort((a, b) => b.size - a.size);

  let compacted = false;
  for (const item of order) {
    const nextEntries = working.entries.map((entry, index) =>
      index === item.index ? { ...entry, organizations: [] } : entry,
    );
    working = { ...working, entries: nextEntries, compacted: true };
    compacted = true;
    serializedBytes = Buffer.byteLength(JSON.stringify(working), 'utf8');
    if (serializedBytes <= maxBytes) break;
  }

  return { document: working, serializedBytes, withinLimit: serializedBytes <= maxBytes };
}

// ─── Adaptador de resumen durable ──────────────────────────────────────────────

/**
 * AGENT1-APOLLO-DURABLE-FENCE-HARD-CRASH-FIX — el ÚNICO lugar que traduce
 * entradas durables (ya filtradas a UNA ronda) al resumen que
 * `runApolloOrganizationsPaginatedSearch` consume.
 *
 * Antes de este corte, la modalidad de dos rondas y la modalidad
 * default/legacy tenían cada una su propia copia de esta traducción, y las
 * dos cometían el MISMO error: sólo `status === 'indeterminate'` bloqueaba
 * páginas nuevas, ignorando `request_started` sin desenlace terminal — el
 * estado EXACTO que deja un proceso que muere justo después de que
 * `beforeRequest` confirmó el intento pero antes de que Apollo respondiera.
 * Ese estado no puede tratarse como "página nunca pedida": Apollo pudo
 * haberla cobrado.
 *
 * `request_started` se trata EXACTAMENTE como `indeterminate` para efectos
 * de resumen: bloquea cualquier página nueva de este plan de búsqueda hasta
 * que se reconcilie explícitamente. Una sola implementación, compartida por
 * las dos modalidades, es lo que garantiza que esa interpretación no pueda
 * volver a divergir entre ellas.
 */
export function toApolloDurableResumeState(
  entriesForRound: readonly ApolloPageFenceEntry[],
): ApolloDurableResumeState {
  const blockingEntry = entriesForRound.find(
    (entry) => entry.status === 'indeterminate' || entry.status === 'request_started',
  );
  return {
    succeededPages: entriesForRound
      .filter((entry) => entry.status === 'succeeded')
      .map((entry) => ({
        page: entry.page,
        requestFingerprint: entry.search_plan_fingerprint,
        organizations: entry.organizations.map(fromApolloPageFenceOrganization),
        credits: entry.credits,
        resultsReturned: entry.results_returned,
        totalPages: entry.total_pages,
        acceptedCount: entry.accepted_count,
      })),
    indeterminatePage: blockingEntry
      ? { page: blockingEntry.page, requestFingerprint: blockingEntry.search_plan_fingerprint }
      : null,
  };
}

/**
 * AGENT1-APOLLO-DURABLE-FENCE-HARD-CRASH-FIX — BLOQUEADOR 2.
 *
 * Cuando la LECTURA de la valla durable falla (no cuando simplemente no hay
 * documento todavía), ninguna página de esta invocación puede pedirse: sin
 * poder leer el documento, no hay forma de saber qué ya se intentó, y
 * proceder trataría un fallo de almacenamiento exactamente igual que "sin
 * páginas previas" — el defecto que este corte cierra.
 *
 * Reutiliza el ÚNICO camino fail-closed que el motor de paginación ya prueba
 * (`beforeRequest` que lanza detiene la búsqueda ANTES de la primera
 * petición HTTP, con 0 créditos — ver `apollo-page-fence-durable-resume.test.ts`
 * § C10) en vez de inventar un segundo mecanismo de parada.
 */
export function buildApolloPageFenceReadFailureBlock(
  reason: string,
): NonNullable<ApolloPaginatedSearchDeps['durableFence']> {
  return {
    beforeRequest: async () => {
      throw new Error(`durable_page_fence_read_failed: ${reason}`);
    },
    onSucceeded: async () => {},
    onIndeterminate: async () => {},
  };
}
