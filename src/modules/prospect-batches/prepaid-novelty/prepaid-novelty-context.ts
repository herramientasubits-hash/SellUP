/**
 * prepaid-novelty-context.ts — el plan PROVEEDOR-NEUTRAL que se resuelve ANTES
 * de reservar o gastar un solo crédito.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 8, 9, 14, 15, 25.
 *
 * ── El defecto económico que este módulo cierra ───────────────────────────────
 *
 * La QA Lusha del 2026-08-19 (lote `e90832f9`) pidió 6 peticiones, recibió 60
 * filas crudas, 40 únicas… y aceptó CERO. El filtrado de calidad funcionó: 24 se
 * descartaron por candidato histórico activo, 10 por duplicado exacto y 6 por
 * precisión. Lo que no funcionó fue el ORDEN: las tres cosas se supieron DESPUÉS
 * de que el proveedor cobrara 6 créditos y $0.529. Todo lo que se descartó ya se
 * sabía en SellUp antes de preguntar.
 *
 * Este contexto es la respuesta: una sola primitiva que responde «¿cuántas
 * empresas útiles NUEVAS ya tengo gratis, y cuántas me faltan de verdad?» antes
 * de que exista una reserva.
 *
 * ── 🔴 Una sola primitiva para los dos proveedores (§ 25) ─────────────────────
 *
 * No hay un planificador para Apollo y otro para Lusha. La capa previa al pago
 * tiene que ser LITERALMENTE la misma o el benchmark Apollo-vs-Lusha compararía
 * dos embudos distintos y le echaría al proveedor la diferencia. Lo específico de
 * cada proveedor empieza DESPUÉS, cuando ya se conocen `residualGap` y las
 * exclusiones que ese proveedor soporta.
 *
 * ── 🔴 `residualGap` NO es responsabilidad económica (§ 16) ───────────────────
 *
 * Este módulo no calcula créditos y no debe empezar a hacerlo. `residualGap` es
 * cuántas empresas FALTAN; cuántas peticiones cuesta encontrarlas lo decide el
 * planificador del proveedor, que sabe de duplicados, de rechazo por precisión y
 * de paginación. Un `requiredCredits = residualGap` sería falso: con hueco 1 una
 * rama de Lusha puede necesitar dos páginas.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

// ─── Resultado de la capa gratuita (§§ 7, 12, 20) ─────────────────────────────

/**
 * Por qué la fuente de país no aportó. Códigos estáticos, sin PII y sin nombres
 * de empresa: viajan a telemetría.
 */
export type PrePaidFreeSourceFailureCode =
  /** El país no tiene fuente gratuita cableada. No es un fallo: es ausencia. */
  | 'country_without_source'
  /** La fuente existe pero no puede aplicar los criterios de la corrida. */
  | 'source_not_criteria_aware'
  /** La lectura de la fuente lanzó, expiró o devolvió un error controlado. */
  | 'source_unavailable'
  /** La macro industria pedida no resuelve contra el catálogo canónico. */
  | 'macro_industry_unresolved';

/**
 * Lo que la fuente gratuita rindió, ya pasada por precisión canónica, dedupe de
 * SellUp y comprobación de HubSpot.
 *
 * 🔴 `acceptedNovel` es lo ÚNICO que puede reducir el hueco. `macroConfirmed` no
 * basta —una empresa confirmada que ya es cliente no es nueva— y `rawReturned`
 * mucho menos: contar filas crudas como descubrimiento útil es exactamente el
 * error que § 4 prohíbe.
 */
export type PrePaidFreeSourceOutcome = {
  /** Fuente consultada. `null` cuando no se intentó ninguna. */
  sourceKey: string | null;
  attempted: boolean;
  /** Filas que la fuente devolvió, antes de cualquier filtro. */
  rawReturned: number;
  /** Empresas cuya evidencia declarada CONFIRMÓ la macro pedida. */
  macroConfirmed: number;
  /** Compatibles sin prueba. No cierran hueco (§ 5). */
  ambiguous: number;
  /** Evidencia declarada de otra macro. No cierran hueco (§ 5). */
  rejected: number;
  /** Confirmadas que SellUp ya conocía (cuenta/candidato activo). */
  sellupKnown: number;
  /** Confirmadas que ya existen en HubSpot. */
  hubspotKnown: number;
  /** Confirmadas, nuevas para SellUp y nuevas para HubSpot. */
  acceptedNovel: number;
  failed: boolean;
  failureCode: PrePaidFreeSourceFailureCode | null;
};

/**
 * La fuente no se intentó. Es el valor por defecto en TODAS las rutas que aún no
 * tienen capacidad de país, y es deliberadamente indistinguible del
 * comportamiento previo al hito: `acceptedNovel = 0` ⇒ `residualGap =
 * requestedTarget` ⇒ el proveedor de pago hace exactamente lo de hoy.
 */
export function notAttemptedFreeSourceOutcome(
  failureCode: PrePaidFreeSourceFailureCode | null = null,
): PrePaidFreeSourceOutcome {
  return {
    sourceKey: null,
    attempted: false,
    rawReturned: 0,
    macroConfirmed: 0,
    ambiguous: 0,
    rejected: 0,
    sellupKnown: 0,
    hubspotKnown: 0,
    acceptedNovel: 0,
    failed: failureCode !== null,
    failureCode,
  };
}

/**
 * La fuente se intentó y falló. FAIL-OPEN hacia el proveedor de pago (§ 12): el
 * hueco vuelve a ser el objetivo entero y la corrida sigue.
 *
 * 🔴 `acceptedNovel` se fuerza a 0 y no se conserva ningún parcial. Una fuente
 * que falló a mitad puede haber contado empresas que nunca llegó a comprobar
 * contra HubSpot; dejarlas reducir el hueco sería inventar cobertura (§ 7).
 */
export function failedFreeSourceOutcome(
  sourceKey: string | null,
  failureCode: PrePaidFreeSourceFailureCode,
  observed?: Partial<Pick<PrePaidFreeSourceOutcome, 'rawReturned'>>,
): PrePaidFreeSourceOutcome {
  return {
    ...notAttemptedFreeSourceOutcome(failureCode),
    sourceKey,
    attempted: true,
    rawReturned: observed?.rawReturned ?? 0,
    failed: true,
  };
}

// ─── Contexto (§ 8) ───────────────────────────────────────────────────────────

/**
 * El plan previo al pago de UNA corrida.
 *
 * Se construye una vez, antes de la reserva, y lo consumen por igual la ruta
 * Apollo y la ruta Lusha.
 */
export type PrePaidNoveltyContext = {
  /** El objetivo del USUARIO. Nunca se reescribe (§ 14). */
  requestedTarget: number;
  countryCode: string;
  macroIndustryKey: string | null;
  freeSource: PrePaidFreeSourceOutcome;
  /** Empresas que SellUp ya conocía con identidad fuerte (§ 9). */
  knownSellupCount: number;
  /** Empresas ya presentes en HubSpot (§ 10). */
  knownHubspotCount: number;
  /**
   * Dominios que el proveedor puede excluir, YA normalizados, deduplicados y
   * acotados. Pista ECONÓMICA, nunca la autoridad de dedupe (§ 11).
   */
  exclusionDomains: readonly string[];
  /** Empresas útiles aceptadas ANTES de gastar. `<= requestedTarget`, siempre. */
  acceptedBeforeProvider: number;
  /** Lo que el proveedor de pago debe buscar de verdad. */
  residualGap: number;
  /** `false` ⇒ ni estimación, ni reserva, ni cliente, ni llamada (§ 15). */
  providerRequired: boolean;
};

export type BuildPrePaidNoveltyContextInput = {
  requestedTarget: number;
  countryCode: string;
  macroIndustryKey?: string | null;
  freeSource?: PrePaidFreeSourceOutcome;
  knownSellupCount?: number;
  knownHubspotCount?: number;
  exclusionDomains?: readonly string[];
};

/**
 * Objetivo saneado. Un objetivo no numérico, no finito o < 1 no puede convertirse
 * en un hueco negativo que después alguien multiplique.
 */
function sanitizeRequestedTarget(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Construye el contexto previo al pago.
 *
 * 🔴 La invariante de § 14 se cumple por CONSTRUCCIÓN, no por comprobación
 * posterior: `acceptedBeforeProvider` se recorta al objetivo antes de restar, así
 * que `acceptedFree + acceptedPaid <= requestedTarget` no depende de que el
 * ejecutor del proveedor se porte bien. El tope de aceptación de #306
 * (`canAcceptLushaUsefulCandidate`) sigue siendo el que cierra el lado pagado.
 */
export function buildPrePaidNoveltyContext(
  input: BuildPrePaidNoveltyContextInput,
): PrePaidNoveltyContext {
  const requestedTarget = sanitizeRequestedTarget(input.requestedTarget);
  const freeSource = input.freeSource ?? notAttemptedFreeSourceOutcome();

  // Una fuente que falló no aporta, aunque traiga conteos: ver `failedFreeSourceOutcome`.
  const rawAccepted = freeSource.failed ? 0 : Math.max(0, Math.trunc(freeSource.acceptedNovel));
  const acceptedBeforeProvider = Math.min(rawAccepted, requestedTarget);
  const residualGap = Math.max(0, requestedTarget - acceptedBeforeProvider);

  return {
    requestedTarget,
    countryCode: input.countryCode,
    macroIndustryKey: input.macroIndustryKey ?? null,
    freeSource,
    knownSellupCount: Math.max(0, Math.trunc(input.knownSellupCount ?? 0)),
    knownHubspotCount: Math.max(0, Math.trunc(input.knownHubspotCount ?? 0)),
    exclusionDomains: input.exclusionDomains ?? [],
    acceptedBeforeProvider,
    residualGap,
    providerRequired: residualGap > 0,
  };
}

/**
 * El contexto que reproduce EXACTAMENTE el comportamiento previo al hito: sin
 * fuente, sin conocidos, sin exclusiones, hueco = objetivo.
 *
 * Existe para que una ruta sin capacidad de país no tenga que construir a mano
 * un contexto «vacío» y pueda equivocarse al hacerlo.
 */
export function providerOnlyPrePaidNoveltyContext(input: {
  requestedTarget: number;
  countryCode: string;
  macroIndustryKey?: string | null;
  failureCode?: PrePaidFreeSourceFailureCode | null;
}): PrePaidNoveltyContext {
  return buildPrePaidNoveltyContext({
    requestedTarget: input.requestedTarget,
    countryCode: input.countryCode,
    macroIndustryKey: input.macroIndustryKey ?? null,
    freeSource: notAttemptedFreeSourceOutcome(input.failureCode ?? null),
  });
}

/**
 * Reajusta el contexto a lo que la ingesta canónica REALMENTE guardó.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 13, 14.
 *
 * 🔴 Sólo una empresa PERSISTIDA cierra hueco. Una empresa descubierta que no se
 * pudo guardar no es una empresa que el usuario tenga: dejarla reducir el
 * objetivo convertiría un fallo de escritura en un ahorro, y el usuario acabaría
 * con menos candidatos de los que pidió sin que nada lo dijera.
 *
 * Con `persistedCount = 0` el contexto vuelve a ser exactamente el de una corrida
 * sin fuente: `residualGap = requestedTarget` y el proveedor de pago hace lo de
 * siempre. Los conteos de descubrimiento (`macroConfirmed`, `sellupKnown`…) se
 * conservan intactos: describen lo que la fuente rindió, y eso pasó de verdad.
 */
export function withFreeSourcePersistenceOutcome(
  context: PrePaidNoveltyContext,
  input: { persistedCount: number },
): PrePaidNoveltyContext {
  const persisted = Math.max(0, Math.trunc(input.persistedCount));
  if (persisted === context.freeSource.acceptedNovel) return context;

  return buildPrePaidNoveltyContext({
    requestedTarget: context.requestedTarget,
    countryCode: context.countryCode,
    macroIndustryKey: context.macroIndustryKey,
    freeSource: { ...context.freeSource, acceptedNovel: persisted },
    knownSellupCount: context.knownSellupCount,
    knownHubspotCount: context.knownHubspotCount,
    exclusionDomains: context.exclusionDomains,
  });
}
