/**
 * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY — la verdad histórica ANTES del gasto.
 *
 * El defecto que cierra: las autoridades históricas FUERTES de Agente 1
 * (`buildNoveltyIndex` / `evaluateCandidateNovelty`, el Active Duplicate Guard,
 * `accounts`) sólo decidían DESPUÉS del enrichment. Una empresa ya entregada
 * podía volver a costar un crédito de Apollo por el simple hecho de aparecer en
 * otro lote, otra `clientRequestId`, otro usuario u otro proveedor.
 *
 * Regla de negocio autorizada:
 *
 *   UNA EMPRESA QUE YA FUE ENTREGADA NO DEBE VOLVER A TRATARSE COMO NUEVA
 *   SÓLO POR HABER CAMBIADO DE BATCH, CLIENT REQUEST, USUARIO O PROVEEDOR.
 *
 * Ámbito: GLOBAL SELLUP. Si el usuario A recibió la empresa X, X sigue siendo
 * histórica cuando la busca el usuario B. Aquí NO se introduce ningún ámbito por
 * usuario ni por organización.
 *
 * ── Las dos políticas que este módulo mantiene SEPARADAS ─────────────────────
 *
 * Antes de este corte había una sola pregunta implícita («¿es nueva?»). Son dos,
 * y no siempre coinciden:
 *
 *   DELIVERY NOVELTY   → «¿se le puede volver a ENTREGAR al usuario?»
 *                        Autoridad: `evaluateCandidateNovelty` (novelty-checker),
 *                        INTACTA. Incluye los cooldowns de `discarded`
 *                        (30 d revisado / 90 d sin revisar), que este corte NO
 *                        toca.
 *
 *   REENRICHMENT COST  → «¿hay que volver a PAGAR por resolverla?»
 *                        Autoridad: este módulo. Una fila que OCUPA el lote como
 *                        candidato es evidencia suficiente de que la empresa ya
 *                        se conocía, sin importar su edad: `approved` a 45 días
 *                        sigue siendo una empresa conocida.
 *
 * La combinación es un OR: basta que UNA de las dos diga «ya conocida» para no
 * pagar. Nunca al revés — este módulo no puede AUTORIZAR un gasto que la novedad
 * de entrega bloquea.
 *
 * ── Identidad: qué basta para un bloqueo DURO pre-pago ───────────────────────
 *
 * Sólo un eje ESTABLE:
 *
 *   1. dominio normalizado  (`normalizeDomain`)
 *   2. identidad fiscal canónica CON PAÍS (`fiscal-identity`, la única autoridad
 *      fiscal de Agente 1 — no se inventa columna ni migración)
 *
 * El NOMBRE por sí solo NO basta. `same_inferred_identity` del Active Duplicate
 * Guard compara nombres normalizados dentro de un país, y dos empresas distintas
 * con el mismo nombre normalizado existen (matriz y filial, homónimas de países
 * distintos). Aquí el nombre se registra como CORROBORACIÓN (`nameOnlyEvidence`)
 * y jamás decide. Prohibido por contrato: Levenshtein, substring, `contains` o
 * cualquier puntuación de similitud.
 *
 * Puro: sin I/O, sin reloj propio (la edad la resuelve la autoridad de novedad),
 * sin env, sin proveedores. No muta sus entradas.
 */

import { normalizeDomain } from './normalization';
import { buildIdentityKey } from './canonical-company-identity';
import {
  buildFiscalIdentityKey,
  buildFiscalIdentityKeyFromRaw,
  resolveStoredFiscalIdentity,
  type FiscalIdentityKey,
} from './fiscal-identity';
import { BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES } from './batch-identity-registry';

// ─── Política por estado ──────────────────────────────────────────────────────

/**
 * Los SIETE estados que la CHECK de `prospect_candidates` admite
 * (`040_prospect_batches_foundation.sql`). Ni uno más: `converted`, `rejected` y
 * `archived` NO existen en la base y no se pueden tratar como si existieran.
 */
export const PROSPECT_CANDIDATE_DB_STATUSES = [
  'generated',
  'normalized',
  'needs_review',
  'approved',
  'discarded',
  'duplicate',
  'converted_to_account',
] as const;

export type ProspectCandidateDbStatus = (typeof PROSPECT_CANDIDATE_DB_STATUSES)[number];

/**
 * Cómo gobierna un estado histórico. Las dos columnas son independientes a
 * propósito: `discarded` fuera de cooldown PUEDE volver a ofrecerse y, aun así,
 * la pregunta económica («¿hay que pagar otra vez?») no es la misma.
 */
export type HistoricalStatusPolicy = {
  /**
   * ¿Impide volver a ENTREGAR la empresa? `'cooldown_governed'` delega en
   * `evaluateCandidateNovelty`, cuya política de 30/90 días este corte conserva.
   */
  blocksHistoricalRedelivery: boolean | 'cooldown_governed';
  /**
   * ¿Impide volver a PAGAR enrichment por ella, con identidad fuerte y sin
   * importar la edad de la fila?
   */
  blocksPrepaymentReenrichment: boolean | 'cooldown_governed';
  /** Por qué. Documenta la decisión; no se consume en tiempo de ejecución. */
  rationale: string;
};

/**
 * Estados que OCUPAN el lote como candidato.
 *
 * No se redefine aquí: es el conjunto canónico de `batch-identity-registry`
 * (`BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES`), que responde exactamente a
 * «¿esta fila ocupa el lote como candidato?». Incluye `generated` y `normalized`
 * porque NO son estados internos transitorios: la cola de revisión los agrupa
 * como pendientes (`BATCH_PENDING_REVIEW_STATUSES`), la UI los rotula «Necesita
 * revisión» y son aprobables. Una empresa en cualquiera de ellos YA se entregó.
 */
const DELIVERY_OCCUPYING_STATUSES: ReadonlySet<string> = new Set(
  BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES,
);

export const PREPAID_HISTORICAL_STATUS_POLICY: Readonly<
  Record<ProspectCandidateDbStatus, HistoricalStatusPolicy>
> = {
  generated: {
    blocksHistoricalRedelivery: true,
    blocksPrepaymentReenrichment: true,
    rationale:
      'Ocupa el lote y la cola de revisión la agrupa como pendiente: es una entrega.',
  },
  normalized: {
    blocksHistoricalRedelivery: true,
    blocksPrepaymentReenrichment: true,
    rationale:
      'Ocupa el lote y la cola de revisión la agrupa como pendiente: es una entrega.',
  },
  needs_review: {
    blocksHistoricalRedelivery: true,
    blocksPrepaymentReenrichment: true,
    rationale:
      'Entrega viva esperando decisión humana. El cooldown de 30 d gobierna la ' +
      'RE-ENTREGA; el coste no vuelve a pagarse ni pasado el cooldown.',
  },
  approved: {
    blocksHistoricalRedelivery: true,
    blocksPrepaymentReenrichment: true,
    rationale: 'Entrega aceptada. Es el caso de los 45 días: ya se conocía.',
  },
  converted_to_account: {
    blocksHistoricalRedelivery: true,
    blocksPrepaymentReenrichment: true,
    rationale:
      'Ya es cuenta. El estado válido es converted_to_account; `converted` no ' +
      'existe en la CHECK y nunca debe usarse.',
  },
  duplicate: {
    blocksHistoricalRedelivery: true,
    blocksPrepaymentReenrichment: true,
    rationale:
      'Duplicado confirmado (novelty Regla 3). Pagar por confirmarlo otra vez no ' +
      'resuelve nada.',
  },
  discarded: {
    blocksHistoricalRedelivery: 'cooldown_governed',
    blocksPrepaymentReenrichment: 'cooldown_governed',
    rationale:
      'Política de re-sugerencia DELIBERADA: 30 d con revisión, 90 d sin ella. ' +
      'Este corte NO la altera — la delega íntegra en evaluateCandidateNovelty. ' +
      'Un descartado FUERA de cooldown puede volver a ofrecerse y, hoy, también ' +
      'a enriquecerse: reutilizar la evidencia previa en vez de recomprarla es ' +
      'una decisión económica SEPARADA, no de este corte.',
  },
};

/** ¿Este estado, por sí solo, prueba que la empresa ya fue entregada? */
export function isDeliveryOccupyingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return DELIVERY_OCCUPYING_STATUSES.has(status);
}

// ─── Entradas ─────────────────────────────────────────────────────────────────

/**
 * Fila histórica de `prospect_candidates`, tal como la devuelve
 * `buildNoveltyIndex`. Los campos fiscales son opcionales: una fila que no los
 * trae simplemente no aporta el eje fiscal — nunca se infiere uno.
 */
export type HistoricalCandidateRow = {
  id?: string | null;
  batch_id?: string | null;
  name?: string | null;
  domain?: string | null;
  status?: string | null;
  duplicate_status?: string | null;
  tax_id?: string | null;
  tax_identifier?: string | null;
  country_code?: string | null;
};

/** La empresa que Apollo acaba de devolver, ANTES de pagar por ella. */
export type PrepaidHistoricalNeedle = {
  /** Ya normalizado por el llamador (`identity.normalizedDomain`). */
  normalizedDomain: string | null;
  /** Nombre crudo del proveedor. SÓLO corrobora. */
  name: string | null;
  /** Identificador fiscal crudo, si la ruta lo trae. Apollo no lo trae. */
  taxIdentifier?: string | null;
  /** País de la solicitud: sin país NO hay igualdad fiscal (CUT-3B1 § 8). */
  countryCode: string | null;
};

/** Eje por el que se estableció la identidad. Ninguno es el nombre. */
export type PrepaidHistoricalIdentityAxis = 'normalized_domain' | 'fiscal_identity';

export type PrepaidHistoricalRejectionReason =
  /** Una fila histórica ocupa el lote con identidad fuerte. */
  | 'historical_delivery_occupies_identity'
  /** La autoridad de novedad de entrega ya lo bloqueaba (cooldown incluido). */
  | 'delivery_novelty_blocks';

export type PrepaidHistoricalVerdict = {
  /** `true` ⇒ NO se enriquece: la empresa ya era conocida. */
  alreadyKnown: boolean;
  reason: PrepaidHistoricalRejectionReason | null;
  matchedAxis: PrepaidHistoricalIdentityAxis | null;
  matchedStatus: string | null;
  matchedCandidateId: string | null;
  /**
   * Se observó una coincidencia SÓLO por nombre normalizado. Se declara para
   * poder auditarla; por sí sola NUNCA produce `alreadyKnown`.
   */
  nameOnlyEvidence: boolean;
  /**
   * La evidencia histórica no se pudo leer (prefetch degradado). Fail-OPEN,
   * igual que el resto de los gates baratos y que la comprobación de HubSpot:
   * no afirmar nada no puede convertirse en una afirmación.
   */
  evidenceUnavailable: boolean;
};

function emptyVerdict(
  overrides: Partial<PrepaidHistoricalVerdict> = {},
): PrepaidHistoricalVerdict {
  return {
    alreadyKnown: false,
    reason: null,
    matchedAxis: null,
    matchedStatus: null,
    matchedCandidateId: null,
    nameOnlyEvidence: false,
    evidenceUnavailable: false,
    ...overrides,
  };
}

// ─── Identidad de una fila histórica ──────────────────────────────────────────

function rowFiscalKey(
  row: HistoricalCandidateRow,
  fallbackCountryCode: string | null,
): FiscalIdentityKey | null {
  const countryCode = row.country_code ?? fallbackCountryCode;
  const stored = resolveStoredFiscalIdentity(
    { tax_id: row.tax_id ?? null, tax_identifier: row.tax_identifier ?? null },
    countryCode,
  );
  // `conflict` es FAIL CLOSED por contrato de CUT-3B1: dos columnas que
  // canonicalizan distinto no eligen una arbitrariamente, así que no aportan eje.
  if (stored.kind !== 'resolved') return null;
  return buildFiscalIdentityKey({ canonical: stored.canonical, countryCode });
}

function rowDomain(row: HistoricalCandidateRow): string | null {
  return row.domain ? normalizeDomain(row.domain) : null;
}

// ─── Evaluación ───────────────────────────────────────────────────────────────

export type EvaluatePrepaidHistoricalInput = {
  needle: PrepaidHistoricalNeedle;
  /**
   * Filas históricas candidatas. El llamador las trae de `buildNoveltyIndex`,
   * que consulta `prospect_candidates` por DOMINIO, sin filtro de `source` y sin
   * ventana temporal: es la autoridad GLOBAL y cross-source que ya usa el writer.
   */
  rows: readonly HistoricalCandidateRow[];
  /**
   * Veredicto de `evaluateCandidateNovelty` para esta misma empresa, si se pudo
   * calcular. Es la autoridad de ENTREGA, con sus cooldowns intactos.
   */
  deliveryNoveltyShouldSkip?: boolean;
  /** El prefetch histórico degradó: no se puede afirmar nada. */
  evidenceUnavailable?: boolean;
};

/**
 * ¿Esta empresa ya era conocida ANTES de pagar?
 *
 * Orden de decisión, deliberado:
 *
 *   1. Evidencia ausente → no se afirma nada (fail-open).
 *   2. Identidad FUERTE (dominio o fiscal) contra una fila que ocupa el lote →
 *      ya conocida, sin importar la edad de la fila.
 *   3. La autoridad de novedad de entrega ya lo bloqueaba → ya conocida.
 *   4. Coincidencia sólo por nombre → se declara como evidencia y NO bloquea.
 */
export function evaluatePrepaidHistoricalDuplicate(
  input: EvaluatePrepaidHistoricalInput,
): PrepaidHistoricalVerdict {
  const { needle, rows } = input;

  if (input.evidenceUnavailable === true) {
    return emptyVerdict({ evidenceUnavailable: true });
  }

  const needleDomain = needle.normalizedDomain
    ? normalizeDomain(needle.normalizedDomain)
    : null;
  const needleFiscalKey = buildFiscalIdentityKeyFromRaw({
    value: needle.taxIdentifier ?? null,
    countryCode: needle.countryCode,
  });
  const needleNameKey = needle.name ? buildIdentityKey(needle.name) : '';

  let nameOnlyEvidence = false;

  for (const row of rows) {
    const strongAxis: PrepaidHistoricalIdentityAxis | null =
      needleDomain !== null && rowDomain(row) === needleDomain
        ? 'normalized_domain'
        : needleFiscalKey !== null &&
            rowFiscalKey(row, needle.countryCode) === needleFiscalKey
          ? 'fiscal_identity'
          : null;

    if (strongAxis === null) {
      // Sin eje fuerte, el nombre se OBSERVA y se declara. Nunca decide: dos
      // empresas distintas pueden compartir nombre normalizado.
      if (
        needleNameKey.length > 0 &&
        row.name &&
        buildIdentityKey(row.name) === needleNameKey
      ) {
        nameOnlyEvidence = true;
      }
      continue;
    }

    if (isDeliveryOccupyingStatus(row.status)) {
      return emptyVerdict({
        alreadyKnown: true,
        reason: 'historical_delivery_occupies_identity',
        matchedAxis: strongAxis,
        matchedStatus: row.status ?? null,
        matchedCandidateId: row.id ?? null,
        nameOnlyEvidence,
      });
    }
  }

  // `discarded` dentro de cooldown, `duplicate` confirmado y `needs_review`
  // reciente entran por aquí: la política ya existente los resuelve y este corte
  // la respeta al pie de la letra.
  if (input.deliveryNoveltyShouldSkip === true) {
    return emptyVerdict({
      alreadyKnown: true,
      reason: 'delivery_novelty_blocks',
      nameOnlyEvidence,
    });
  }

  return emptyVerdict({ nameOnlyEvidence });
}
