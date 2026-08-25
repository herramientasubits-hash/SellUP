// Agente 2A — Núcleo PURO del reveal de teléfono DESDE UN CONTACTO OFICIAL
// (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1)
//
// Sin red, sin DB, sin auth, sin reloj propio y sin un solo import de servidor. Cuatro cosas:
//
//   1. resolver el CANDIDATO FUENTE de un contacto oficial a partir de la ÚNICA prueba durable
//      que existe (`contacts.metadata.source_candidate_id`), fail-closed;
//   2. clasificar QUÉ se le puede ofrecer al operador sobre ese contacto — nada, reutilizar lo
//      que ya está pagado, o autorizar una compra — sin decidir nunca el precio;
//   3. construir los parámetros POSICIONALES de la RPC de la migración 128;
//   4. parsear su sobre sin confiar en su forma.
//
// LO QUE ESTE MÓDULO NO HACE, Y ES SU RAZÓN DE SER: no calcula un tope de créditos, no clasifica
// una modalidad de waterfall, no decide si Lusha es alcanzable y no conoce el presupuesto. Todo
// eso YA existe, keyed por `candidateId`, en `phone-reveal-waterfall-core.ts` y en
// `phone-reveal-core.ts`. Este hito NO construye un segundo waterfall: resuelve el candidato y
// delega en el que ya está probado. Duplicar aquí la regla del tope es exactamente lo que
// permitiría que la ficha del contacto y el servidor discreparan sobre lo que se va a gastar.

// El tipo del pipeline del candidato se importa SÓLO como tipo: no hay dependencia de
// runtime, así que este módulo sigue siendo puro y seguro en el bundle del cliente. Se
// importa en vez de copiarse porque una segunda copia de la unión de estados sería la
// superficie del reveal divergiendo según quién la lea.
import type { RevealCandidatePhoneStatus } from './phone-reveal-core';

/** Nombre de la función de la migración 128. Un solo sitio lo nombra. */
export const PROJECT_APPROVED_CANDIDATE_PHONES_FN =
  'project_approved_candidate_phones_onto_contact' as const;

/**
 * La clave de `contacts.metadata` que la aprobación escribe con el candidato del que nació el
 * contacto (`buildContactTraceMetadata`). Es la MISMA clave que el camino DSAR ya usa para
 * descubrir qué contacto alcanzar desde un candidato, así que no se introduce un segundo vínculo.
 */
export const OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY = 'source_candidate_id' as const;

// ── 1. Resolución del candidato fuente ─────────────────────────────

export type OfficialContactSourceCandidateResolution =
  | { readonly kind: 'resolved'; readonly candidateId: string }
  /** No hay clave, o está vacía: el contacto no declara haber nacido de ningún candidato. */
  | { readonly kind: 'missing' }
  /** Hay clave pero no es un uuid: se trata como ausencia, nunca como "casi bueno". */
  | { readonly kind: 'malformed' };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resuelve el candidato fuente de un contacto oficial. FAIL-CLOSED por contrato (§9): la ausencia
 * NO se compensa con una búsqueda por email, nombre o teléfono.
 *
 * POR QUÉ ESO IMPORTA Y NO ES PEDANTERÍA: el candidato fuente es lo que determina la
 * AUTORIZACIÓN ECONÓMICA — qué proveedores quedan por intentar, si la identidad Lusha ya está
 * comprada, cuánto se va a reservar. Un candidato "parecido", encontrado por email o por nombre,
 * puede tener otro origen, otro historial de reveal y otra identidad persistida: autorizar un
 * gasto contra él sería cobrarle al operador un tope calculado sobre otra persona. Sin prueba
 * durable no se ofrece nada.
 */
export function resolveOfficialContactSourceCandidateId(
  metadata: unknown,
): OfficialContactSourceCandidateResolution {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { kind: 'missing' };
  }
  const raw = (metadata as Record<string, unknown>)[
    OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY
  ];
  if (raw === undefined || raw === null) return { kind: 'missing' };
  const text = cleanText(raw);
  if (!text) return { kind: 'missing' };
  if (!UUID_RE.test(text)) return { kind: 'malformed' };
  return { kind: 'resolved', candidateId: text };
}

// ── 2. Qué se le puede ofrecer al operador ─────────────────────────

export type OfficialContactPhoneRevealOfferStatus =
  /** Se puede AUTORIZAR una compra. El tope lo calcula la vista previa del candidato, no aquí. */
  | 'eligible'
  /**
   * Hay teléfonos YA PAGADOS en la colección del candidato que el contacto no tiene. La acción
   * correcta es PROYECTARLOS: cero proveedor, cero créditos, cero reservas (§10).
   */
  | 'reuse_from_candidate'
  /** El contacto ya tiene un teléfono reutilizable: no se ofrece reveal normal (§11). */
  | 'phone_already_present'
  /** Sin candidato fuente durable no se ofrece nada (§9, fail-closed). */
  | 'missing_source_candidate'
  /** El contacto está archivado: no se compra nada para un registro retirado. */
  | 'contact_archived'
  /** No hay contacto legible (no existe, fuera de alcance, o la lectura falló). */
  | 'contact_unavailable';

export interface OfficialContactPhoneRevealOfferInput {
  /** Proyección mínima del contacto. `null` ⇒ no legible. */
  readonly contact:
    | {
        readonly id: string;
        readonly archivedAt?: string | null;
        readonly phone?: string | null;
        readonly mobilePhone?: string | null;
        readonly metadata?: unknown;
      }
    | null
    | undefined;
  /**
   * Filas VIVAS de la colección oficial del contacto. Un contacto puede tenerla con
   * el escalar heredado en NULL (es lo que deja una erasura de la 115 sobre el principal), así
   * que el escalar por sí solo no responde «tiene teléfono».
   */
  readonly liveOfficialPhoneCount: number;
  /**
   * Filas VIVAS de `contact_enrichment_candidate_phones` del candidato fuente. `0` cuando no hay
   * candidato resuelto o cuando no se pudo leer — fail-closed hacia «no prometer reutilización».
   */
  readonly candidateLivePhoneCount: number;
}

export interface OfficialContactPhoneRevealOffer {
  readonly status: OfficialContactPhoneRevealOfferStatus;
  /** El candidato fuente cuando existe. Es lo que la acción usa para delegar. */
  readonly candidateId: string | null;
  /** true SOLO en `reuse_from_candidate` y `eligible`: los dos casos en que hay algo que hacer. */
  readonly actionable: boolean;
  /** true cuando la siguiente acción NO puede gastar un crédito. */
  readonly free: boolean;
}

/**
 * Decide qué ofrece la ficha del contacto oficial, con el ORDEN de precedencia explícito.
 *
 * El fail-closed del candidato fuente va ANTES de mirar teléfonos a propósito: si no hay prueba
 * durable del origen no hay nada que ofrecer, ni gratis ni pagado, y esa respuesta no depende de
 * lo que el contacto tenga guardado.
 *
 * La reutilización (§10) se ofrece SOLO cuando el contacto no tiene ni escalar ni colección viva.
 * Con colección viva no se puede afirmar desde aquí que falte algo —los `dedupe_key` habría que
 * comparar uno a uno, y esa comparación es de la RPC, que la hace bajo el lock con
 * `ON CONFLICT DO NOTHING`— así que se cae al caso conservador en vez de prometer un botón que
 * no haría nada.
 */
export function classifyOfficialContactPhoneRevealOffer(
  input: OfficialContactPhoneRevealOfferInput,
): OfficialContactPhoneRevealOffer {
  const contact = input.contact;
  if (!contact) {
    return { status: 'contact_unavailable', candidateId: null, actionable: false, free: true };
  }
  if (cleanText(contact.archivedAt)) {
    return { status: 'contact_archived', candidateId: null, actionable: false, free: true };
  }

  const link = resolveOfficialContactSourceCandidateId(contact.metadata);
  if (link.kind !== 'resolved') {
    return {
      status: 'missing_source_candidate',
      candidateId: null,
      actionable: false,
      free: true,
    };
  }

  const liveOfficial = Number.isFinite(input.liveOfficialPhoneCount)
    ? Math.max(0, Math.trunc(input.liveOfficialPhoneCount))
    : 0;
  const candidateLive = Number.isFinite(input.candidateLivePhoneCount)
    ? Math.max(0, Math.trunc(input.candidateLivePhoneCount))
    : 0;

  const hasScalar =
    cleanText(contact.phone) !== null || cleanText(contact.mobilePhone) !== null;

  if (hasScalar || liveOfficial > 0) {
    return {
      status: 'phone_already_present',
      candidateId: link.candidateId,
      actionable: false,
      free: true,
    };
  }

  if (candidateLive > 0) {
    return {
      status: 'reuse_from_candidate',
      candidateId: link.candidateId,
      actionable: true,
      free: true,
    };
  }

  return { status: 'eligible', candidateId: link.candidateId, actionable: true, free: false };
}

// ── 3. Parámetros de la RPC de la 128 ──────────────────────────────

export interface ProjectApprovedCandidatePhonesRequest {
  readonly candidateId: string;
  /**
   * TOKEN DE CONFIRMACIÓN, no una instrucción. La 128 exige que sea IGUAL a
   * `candidate.matched_contacts_id` —el valor que escribió la aprobación— y rechaza cualquier
   * otro uuid.
   */
  readonly contactId: string;
  /**
   * El `CandidateScalarFallback` de `buildCandidateScalarFallback()`, sin tocar. El MISMO builder
   * que usan la aprobación (116) y el merge (117): una segunda inversión de procedencia sería la
   * misma tabla divergiendo según quién la lea.
   */
  readonly scalarFallback: Record<string, unknown> | null;
  readonly actorId: string;
  readonly nowIso: string;
}

/**
 * Parámetros POSICIONALES de la migración 128, con los nombres exactos de sus argumentos. Un
 * solo sitio los nombra, así que un cambio de firma rompe la compilación en vez de degradar
 * silenciosamente a una llamada que PostgREST no resuelve.
 */
export function buildProjectApprovedCandidatePhonesParams(
  request: ProjectApprovedCandidatePhonesRequest,
): Record<string, unknown> {
  return {
    p_candidate_id: request.candidateId,
    p_contact_id: request.contactId,
    p_scalar_fallback: request.scalarFallback,
    p_actor_id: request.actorId,
    p_now: request.nowIso,
  };
}

// ── 4. Sobre de respuesta ──────────────────────────────────────────

export type ProjectApprovedCandidatePhonesStatus =
  | 'projected'
  | 'invalid_input'
  | 'candidate_not_found'
  | 'candidate_not_projectable'
  | 'contact_link_missing'
  | 'contact_link_mismatch'
  | 'contact_not_found'
  | 'contact_mismatch'
  | 'contact_not_projectable'
  | 'person_suppressed'
  | 'scalar_incumbent_unprojectable';

export type ProjectedScalarFallbackOutcome = 'promoted' | 'unrepresentable' | 'absent';

export interface ProjectApprovedCandidatePhonesOutcome {
  readonly status: ProjectApprovedCandidatePhonesStatus;
  readonly detail: string | null;
  readonly candidateId: string | null;
  readonly contactId: string | null;
  readonly phonesSeen: number;
  readonly phonesInserted: number;
  readonly phonesReused: number;
  readonly phonesSkippedSuppressed: number;
  readonly sourcesInserted: number;
  readonly sourcesReused: number;
  /** SHA-256 por diseño de la 114. NUNCA el número. */
  readonly primaryDedupeKey: string | null;
  readonly primaryElectedNow: boolean;
  readonly scalarSynced: boolean;
  readonly scalarFallback: ProjectedScalarFallbackOutcome;
}

const PROJECT_STATUSES: readonly ProjectApprovedCandidatePhonesStatus[] = [
  'projected',
  'invalid_input',
  'candidate_not_found',
  'candidate_not_projectable',
  'contact_link_missing',
  'contact_link_mismatch',
  'contact_not_found',
  'contact_mismatch',
  'contact_not_projectable',
  'person_suppressed',
  'scalar_incumbent_unprojectable',
];

const SCALAR_FALLBACK_OUTCOMES: readonly ProjectedScalarFallbackOutcome[] = [
  'promoted',
  'unrepresentable',
  'absent',
];

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Parsea el sobre SIN confiar en él. Un estado desconocido no se propaga como éxito: LANZA. Un
 * sobre con forma inesperada tras un COMMIT es exactamente el caso en el que adivinar produce un
 * «proyectado» que nadie escribió.
 */
export function parseProjectApprovedCandidatePhonesEnvelope(
  data: unknown,
): ProjectApprovedCandidatePhonesOutcome {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'project_approved_candidate_phones_onto_contact: envelope is not an object',
    );
  }
  const row = data as Record<string, unknown>;
  const status = row.status;
  if (
    typeof status !== 'string' ||
    !PROJECT_STATUSES.includes(status as ProjectApprovedCandidatePhonesStatus)
  ) {
    throw new Error(
      'project_approved_candidate_phones_onto_contact: unknown envelope status',
    );
  }
  const fallbackRaw = row.scalar_fallback;
  const scalarFallback =
    typeof fallbackRaw === 'string' &&
    SCALAR_FALLBACK_OUTCOMES.includes(fallbackRaw as ProjectedScalarFallbackOutcome)
      ? (fallbackRaw as ProjectedScalarFallbackOutcome)
      : 'absent';

  return {
    status: status as ProjectApprovedCandidatePhonesStatus,
    detail: asText(row.detail),
    candidateId: asText(row.candidate_id),
    contactId: asText(row.contact_id),
    phonesSeen: asCount(row.phones_seen),
    phonesInserted: asCount(row.phones_inserted),
    phonesReused: asCount(row.phones_reused),
    phonesSkippedSuppressed: asCount(row.phones_skipped_suppressed),
    sourcesInserted: asCount(row.sources_inserted),
    sourcesReused: asCount(row.sources_reused),
    primaryDedupeKey: asText(row.primary_dedupe_key),
    primaryElectedNow: row.primary_elected_now === true,
    scalarSynced: row.scalar_synced === true,
    scalarFallback,
  };
}

// ── 5. Las dos vistas que la ficha del contacto consume ────────────
//
// Viven AQUÍ y no en el archivo de server actions por una razón mecánica, no estética: Next
// envuelve TODA exportación de un módulo `'use server'` como Server Action y lista los exports
// por NOMBRE, así que un `export type { … }` allí tumba la ruta en producción
// (AGENT2A-P0-R4 / P342). Los tipos van en un módulo sin la directiva.

/**
 * Lo que la ficha necesita saber ANTES del clic. PII-free: un estado, dos booleanos y un entero.
 *
 * `maxCredits` NO se calcula aquí: viene de
 * `getPhoneRevealWaterfallAuthorizationPreviewAction`, que es la MISMA función que resuelve la
 * modalidad en el arranque. `null` significa «no se pudo calcular» y la UI cae a su copy
 * conservador; nunca se rellena con un suelo inventado, porque un tope inventado que resulte
 * menor que el real hace que el arranque rechace la autorización por techo (y uno mayor le
 * promete al operador un gasto que nadie va a reservar).
 */
export interface OfficialContactPhoneRevealOfferView {
  readonly status: OfficialContactPhoneRevealOfferStatus;
  /** true sólo cuando hay algo que el operador pueda accionar. */
  readonly actionable: boolean;
  /** true cuando la acción disponible NO puede gastar un crédito (reutilización). */
  readonly free: boolean;
  readonly maxCredits: number | null;
  readonly requiresIdentitySearch: boolean;
  readonly lushaEligible: boolean;
}

/**
 * Desenlace de un clic. Separa TRES cosas que el operador necesita distinguir y que colapsadas
 * en un solo string mienten:
 *
 *   * `gate`      — si el contacto oficial pudo delegar (y si no, por qué);
 *   * `revealStatus` — lo que contestó el pipeline del candidato, TAL CUAL, sin re-mapear: es la
 *                      misma superficie de estados que la ficha del candidato ya sabe leer;
 *   * `projection` — si el teléfono llegó al contacto, que es una pregunta distinta de si el
 *                    proveedor contestó. En el camino asíncrono la respuesta correcta es «aún
 *                    no», y decir «revelado» ahí sería afirmar que la ficha ya tiene un número.
 */
export interface OfficialContactPhoneRevealStartResult {
  readonly ok: boolean;
  readonly gate: 'delegated' | OfficialContactPhoneRevealOfferStatus;
  readonly revealStatus: RevealCandidatePhoneStatus | null;
  readonly projectionStatus: ProjectApprovedCandidatePhonesStatus | null;
  /** true SOLO cuando la proyección dejó el número en el contacto en esta misma llamada. */
  readonly phoneProjected: boolean;
  readonly errorCode: string | null;
}
