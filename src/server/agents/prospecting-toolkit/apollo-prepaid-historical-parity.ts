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
 *                        INTACTA en su código y en su vocabulario, cooldowns de
 *                        `discarded` incluidos (30 d revisado / 90 d sin
 *                        revisar).
 *
 *                        🔴 AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY: esos
 *                        cooldowns SIGUEN EXISTIENDO pero ya NO son la autoridad
 *                        de novedad histórica de entrega. Una empresa entregada y
 *                        después descartada no vuelve a ser nueva a los 31 ni a
 *                        los 91 días. Ver `HISTORICAL_DELIVERY_STATUSES`.
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
// AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY § 2 — «entregada» no es «existe una
// fila»: es «existe una fila que salió de una corrida real». La autoridad es el
// clasificador canónico de procedencia, el mismo que lee el modelo de efectividad
// y el mismo que ya usa la memoria negativa de discovery. Puro: sin I/O.
import {
  deriveRecordOriginClassification,
  type RecordOrigin,
} from '@/modules/agent1-effectiveness/classification';

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
      'resuelve nada. Ya era permanente antes de FINALITY y lo sigue siendo.',
  },
  discarded: {
    // AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY § 8 — antes decía
    // 'cooldown_governed' en las DOS columnas, y eso es exactamente lo que
    // permitía que una empresa ya entregada volviera a ser nueva a los 31 d
    // (revisada) o a los 91 d (sin revisar). La ventana ya no gobierna la
    // NOVEDAD de entrega.
    blocksHistoricalRedelivery: true,
    blocksPrepaymentReenrichment: true,
    rationale:
      'Un descarte es un RESULTADO DE REVISIÓN sobre una entrega que sí ocurrió: ' +
      'el estado no borra el hecho. La memoria de entrega es PERMANENTE con ' +
      'identidad fuerte y procedencia productiva — 5 d, 31 d, 91 d, 200 d y 365 d ' +
      'dan el mismo veredicto. Los cooldowns de 30/90 d NO se eliminan: siguen ' +
      'vivos en evaluateCandidateNovelty como política de revisión y analítica ' +
      '(reason, cooldown_until), pero dejan de ser la autoridad de novedad.',
  },
};

/**
 * ¿Este estado prueba que la fila TODAVÍA OCUPA el lote como candidato?
 *
 * 🔴 No es «¿ya se entregó?». Ésa la responde `isHistoricalDeliveryStatus`, y son
 * preguntas distintas desde AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY:
 * `discarded` y `duplicate` NO ocupan el lote —son resultados de revisión sobre
 * una fila que ya perdió su sitio— y sin embargo SÍ prueban una entrega pasada.
 * Este predicado se conserva con su semántica original, sin tocar el conjunto
 * canónico de `batch-identity-registry`, porque CUT-3A/CUT-3B dependen de que un
 * descarte previo NO impida la llegada del candidato legítimo DENTRO de un lote.
 */
export function isDeliveryOccupyingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return DELIVERY_OCCUPYING_STATUSES.has(status);
}

// ─── HISTORICAL DELIVERY FINALITY ─────────────────────────────────────────────

/**
 * AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY — la memoria de ENTREGA es
 * PERMANENTE.
 *
 * El defecto que cierra este corte: `discarded` fuera de cooldown (30 d con
 * revisión, 90 d sin ella) volvía a ser una empresa NUEVA. Agente 1 la había
 * encontrado y entregado, la usuaria la había descartado, y meses después Apollo
 * la volvía a cobrar y a entregar como si nunca hubiera existido.
 *
 * Regla de negocio autorizada:
 *
 *   UNA EMPRESA YA ENTREGADA POR AGENTE 1 NO VUELVE A SER UNA EMPRESA NUEVA,
 *   AUNQUE DESPUÉS HAYA SIDO DESCARTADA.
 *
 * ── Dos conceptos que dejan de estar fusionados ───────────────────────────────
 *
 *   DELIVERY HISTORY        ≠   CURRENT REVIEW STATUS
 *
 * El estado puede decir `needs_review`, `approved`, `discarded`,
 * `converted_to_account` o `duplicate`. Ninguno de esos valores BORRA el hecho
 * «Agente 1 ya entregó esta empresa». Por eso los SIETE estados de la CHECK real
 * prueban una entrega: la fila existe porque hubo una entrega que la creó.
 *
 * ── Qué NO hace este corte ────────────────────────────────────────────────────
 *
 * No convierte `discarded` en `duplicate`. No muta la fila histórica. No toca el
 * historial de revisión, ni `reviewed_at`, ni la metadata de cooldown. Los
 * cooldowns de 30/90 días SIGUEN EXISTIENDO en `evaluateCandidateNovelty` y
 * siguen siendo política de revisión y analítica; lo único que cambia es que ya
 * NO son la autoridad de «¿es nueva esta empresa?».
 *
 * ── Ventana temporal: NINGUNA ─────────────────────────────────────────────────
 *
 * Con identidad FUERTE (dominio normalizado o identidad fiscal canónica con
 * país), la edad de la fila es irrelevante: 5 días, 31, 91, 200 o 365 dan el
 * mismo veredicto. Sin identidad fuerte no hay bloqueo duro y el nombre nunca
 * decide (§ 5 / § 18).
 *
 * Fail-closed: un estado que no está en la CHECK no prueba ninguna entrega.
 */
const HISTORICAL_DELIVERY_STATUSES: ReadonlySet<string> = new Set(
  PROSPECT_CANDIDATE_DB_STATUSES,
);

/**
 * ¿Una fila con este estado prueba que la empresa YA FUE ENTREGADA alguna vez?
 *
 * Los siete estados válidos responden sí. Es deliberado y es el corazón del
 * corte: el estado describe en qué punto de la revisión quedó la entrega, no si
 * la entrega ocurrió.
 */
export function isHistoricalDeliveryStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return HISTORICAL_DELIVERY_STATUSES.has(status);
}

/**
 * § 2 — clases de procedencia que NO son entregas productivas reales.
 *
 * Autoridad canónica ÚNICA, compartida con `loadDiscoveryNegativeMemory` (que la
 * importa de aquí en vez de mantener una copia): dos listas del mismo concepto
 * habrían divergido.
 *
 *   - `smoke_test`, `qa`, `historical_cleanup`, `synthetic` → la fila no salió de
 *     una corrida comercial real. Nunca se le entregó a nadie, así que no puede
 *     congelar el universo para siempre.
 *   - `production`, `import` y `unknown` SÍ quedan dentro: forman parte del
 *     universo real de SellUp, y en protección de coste «no sé» no puede leerse
 *     como «no existe».
 */
export const NON_DELIVERY_RECORD_ORIGINS: ReadonlySet<RecordOrigin> =
  new Set<RecordOrigin>(['smoke_test', 'qa', 'historical_cleanup', 'synthetic']);

/**
 * ¿Esta fila histórica pertenece a una entrega PRODUCTIVA real?
 *
 * Sin esta puerta, un solo descarte de smoke/QA envenenaría un dominio real para
 * siempre — exactamente el daño que la política de memoria negativa ya evita en
 * `evaluateCandidateNovelty` (Reglas 4/4a/4b) al excluir QA/smoke. No se
 * enumera ninguna lista de `batch.source`: la procedencia se juzga por FILA.
 */
export function isProductiveDeliveryRow(row: HistoricalCandidateRow): boolean {
  const classification = deriveRecordOriginClassification({
    status: row.status ?? null,
    duplicate_status: row.duplicate_status ?? null,
    source_primary: row.source_primary ?? null,
    review_notes: row.review_notes ?? null,
    metadata: row.metadata ?? null,
  });
  return !NON_DELIVERY_RECORD_ORIGINS.has(classification.recordOrigin);
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
  /**
   * AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY § 2 — las tres entradas que el
   * clasificador canónico de procedencia necesita para decidir si la fila salió
   * de una corrida real. Son columnas YA EXISTENTES de `prospect_candidates`
   * (las mismas que lee `loadDiscoveryNegativeMemory`): no hay migración, no hay
   * backfill y no hay consulta nueva — se añaden al SELECT que ya se hacía.
   *
   * Ausentes ⇒ la procedencia se resuelve con lo que haya. `unknown` queda
   * DENTRO del universo: en protección de coste no se puede leer «no sé» como
   * «no existe».
   */
  source_primary?: string | null;
  review_notes?: string | null;
  metadata?: Record<string, unknown> | null;
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
  /**
   * AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY § 23 — la entrega histórica es
   * PERMANENTE: la fila ya no ocupa el lote (`discarded`, `duplicate`) pero
   * prueba una entrega productiva pasada con identidad fuerte.
   *
   * Es un motivo NUEVO y provider-neutral, no uno por estado. Se separa de
   * `historical_delivery_occupies_identity` porque los dos hechos son distintos
   * —«sigue ocupando» vs «se entregó y se resolvió»— y de
   * `delivery_novelty_blocks` porque este bloqueo NO depende del cooldown:
   * `cooldown_or_prior_suggestion` se volvía ambiguo justo cuando el bloqueo
   * dejó de ser temporal.
   */
  | 'historical_delivery_duplicate'
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
 *   2. Identidad FUERTE (dominio o fiscal) contra una fila que ocupa el lote
 *      Y es PRODUCTIVA → ya conocida, sin importar la edad de la fila.
 *   3. Identidad FUERTE contra una ENTREGA HISTÓRICA productiva ya resuelta
 *      (`discarded`, `duplicate`) → ya conocida, sin ventana temporal
 *      (FINALITY § 3, § 8, § 16).
 *   4. La autoridad de novedad de entrega ya lo bloqueaba → ya conocida.
 *   5. Coincidencia sólo por nombre → se declara como evidencia y NO bloquea.
 *
 * AGENT1-APOLLO-HISTORICAL-FINALITY-ORIGIN-FIX — el paso 2 exigía identidad
 * fuerte pero NO procedencia productiva, a diferencia del paso 3. Un artefacto
 * de smoke/QA/synthetic/historical_cleanup que quedaba OCUPANDO el lote (p.ej.
 * `needs_review`, `approved`) congelaba un dominio real para siempre, algo que
 * el paso 3 ya evitaba para `discarded`/`duplicate`. Ambos pasos comparten
 * ahora la misma frontera de procedencia (`isProductiveDeliveryRow`): la
 * memoria PERMANENTE exige entrega productiva, ocupe o no el lote.
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

    // AGENT1-APOLLO-HISTORICAL-FINALITY-ORIGIN-FIX — «ocupa el lote» sólo
    // prueba una entrega PERMANENTE si además es productiva. Sin esta puerta,
    // un smoke/QA/synthetic/historical_cleanup que quedó `needs_review` o
    // `approved` congelaba el dominio real para siempre — el mismo daño que
    // `isProductiveDeliveryRow` ya evitaba para `discarded`/`duplicate` más
    // abajo. `BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES` (ocupación dentro del
    // lote vivo) queda intacto: esto sólo gobierna memoria PERMANENTE.
    if (isDeliveryOccupyingStatus(row.status) && isProductiveDeliveryRow(row)) {
      return emptyVerdict({
        alreadyKnown: true,
        reason: 'historical_delivery_occupies_identity',
        matchedAxis: strongAxis,
        matchedStatus: row.status ?? null,
        matchedCandidateId: row.id ?? null,
        nameOnlyEvidence,
      });
    }

    /**
     * AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY — la fila ya no ocupa el lote
     * (`discarded`, `duplicate`), pero SÍ prueba una entrega pasada.
     *
     * Sin ventana temporal: la edad no rehabilita la novedad. La procedencia SÍ
     * se exige —una fila de smoke/QA/limpieza/dato fabricado nunca se le entregó
     * a nadie y no puede congelar un dominio real para siempre. Desde
     * AGENT1-APOLLO-HISTORICAL-FINALITY-ORIGIN-FIX el bloque anterior exige la
     * MISMA puerta para los estados que ocupan el lote, así que una fila que
     * llegó hasta aquí sin `isProductiveDeliveryRow` ya falló ese chequeo y
     * también fallará éste: no hay una segunda vía que la deje colarse.
     */
    if (isHistoricalDeliveryStatus(row.status) && isProductiveDeliveryRow(row)) {
      return emptyVerdict({
        alreadyKnown: true,
        reason: 'historical_delivery_duplicate',
        matchedAxis: strongAxis,
        matchedStatus: row.status ?? null,
        matchedCandidateId: row.id ?? null,
        nameOnlyEvidence,
      });
    }
  }

  // Red de seguridad, ya no la vía principal para `discarded`/`duplicate`: desde
  // FINALITY esos dos los resuelve el paso anterior con identidad fuerte y sin
  // ventana. Aquí siguen entrando los casos que la novedad de entrega bloquea sin
  // que haya identidad fuerte disponible —y los descartes de smoke/QA DENTRO de
  // cooldown, que la propia novedad ya excluye de la memoria negativa.
  if (input.deliveryNoveltyShouldSkip === true) {
    return emptyVerdict({
      alreadyKnown: true,
      reason: 'delivery_novelty_blocks',
      nameOnlyEvidence,
    });
  }

  return emptyVerdict({ nameOnlyEvidence });
}
