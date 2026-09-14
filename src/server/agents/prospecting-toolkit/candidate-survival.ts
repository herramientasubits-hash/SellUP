/**
 * candidate-survival.ts — AGENT1-CANDIDATE-SURVIVAL-X5.
 *
 * La separación semántica que faltaba: SUPERVIVENCIA no es ACEPTACIÓN, y
 * ninguna de las dos es CONTAR HACIA EL OBJETIVO.
 *
 * El defecto que cierra, medido en la certificación `c7c28980…` (CO × retail ×
 * target 5, Apollo): 34 empresas únicas, 15 rechazadas por ownership, 1 por
 * evidencia sectorial CONTRADICTORIA —las 16 con causa real— y 18 que no
 * tenían ninguna causa de rechazo. Esas 18 pasaron todos los gates
 * obligatorios y terminaron igualmente en `prospect_discarded_dispositions`
 * con `enrichment_budget_exhausted`, porque el cap de enrichment de la corrida
 * (5) se agotó antes de que les tocara competir. Su único pecado fue llegar las
 * sextas.
 *
 * La causa raíz no era el cap: era que la elegibilidad se leía como
 * supervivencia. Una empresa cuyo sector no estaba CONFIRMADO no era elegible,
 * y no ser elegible era, de facto, desaparecer — salvo que hubiera pagado un
 * enrichment, único billete a la cohorte de revisión. Es decir: haber podido
 * gastar era requisito para sobrevivir.
 *
 * Este módulo invierte esa dependencia y la deja escrita en tipos:
 *
 *   · Los gates OBLIGATORIOS deciden si una empresa sobrevive. Sólo ellos.
 *   · El enrichment y los catálogos propios COMPLETAN información. Nunca
 *     rechazan. Su ausencia es ausencia de evidencia, no evidencia en contra.
 *   · Sobrevivir INCOMPLETA es un desenlace legítimo: `needs_review`.
 *   · Contar hacia el objetivo es una pregunta POSTERIOR y distinta, que
 *     responde el contrato canónico (`evaluateCandidateTargetEligibility`), no
 *     este módulo. Aquí no se exporta nada que se llame `countsTowardTarget`
 *     precisamente para que nadie pueda confundirlas de nuevo.
 *
 * Provider-agnóstico por construcción: la entrada es estructural y no nombra a
 * ningún proveedor. No hay —ni puede haber— una rama `if (provider === …)`.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

// ─── 1. Evidencia sectorial: confirmada, ausente o contraria ──────────────────

/**
 * El vocabulario sectorial del pipeline, reducido a las TRES únicas preguntas
 * que la supervivencia necesita responder.
 *
 * La distinción que este corte existe para hacer es la de en medio:
 *
 *   `sector_confirmed`            — hay evidencia y confirma. Puede optar al
 *                                   objetivo.
 *   `sector_evidence_absent`      — NO hay evidencia. Ni a favor ni en contra.
 *                                   El candidato sobrevive incompleto.
 *   `sector_mandatory_rejection`  — hay evidencia EN CONTRA, o falta la política
 *                                   con la que juzgarla. Rechazo real.
 *
 * `sector_not_mapped` queda deliberadamente en el tercer grupo, donde ya
 * estaba: significa «el proveedor declaró un sector y SellUp no tiene política
 * para juzgarlo», y convertirlo en supervivencia equivale a aceptar cualquier
 * empresa en toda corrida sin política sectorial. Esa es una decisión de
 * producto distinta de la de este corte, y se reporta en vez de tomarse. Lo
 * que sí se corrige es lo que este corte sí puede afirmar: la corrida
 * `c7c28980` no tuvo ni un solo `sector_not_mapped` —su única baja sectorial
 * fue `sector_evidence_contradictory`— así que ninguna de las 18 empresas que
 * este módulo rescata depende de reclasificarlo.
 */
export type SectorEvidenceDisposition =
  | 'sector_confirmed'
  | 'sector_evidence_absent'
  | 'sector_mandatory_rejection';

/**
 * Los estados en los que la evidencia sectorial simplemente NO EXISTE.
 *
 * Los dos comparten desenlace y se distinguen por su causa: en el primero hay
 * política de sector y el proveedor no dijo lo suficiente; en el segundo no hay
 * política y el proveedor no declaró nada. Ninguno afirma nada sobre la empresa.
 */
const SECTOR_EVIDENCE_ABSENT_STATES: ReadonlySet<string> = new Set([
  'sector_evidence_missing_needs_enrichment',
  'sector_evidence_missing_bootstrap_eligible',
]);

/**
 * Clasifica un estado sectorial. Estructural a propósito: acepta `string` para
 * que este módulo no importe nada del pipeline de ningún proveedor.
 *
 * Fail-closed: un estado desconocido NO se asume ausente. Inventar
 * supervivencia para un vocabulario que este módulo no reconoce sería
 * exactamente el error simétrico al que cierra.
 */
export function classifySectorEvidence(
  sectorEvidenceState: string,
): SectorEvidenceDisposition {
  if (sectorEvidenceState === 'sector_evidence_confirmed') return 'sector_confirmed';
  if (SECTOR_EVIDENCE_ABSENT_STATES.has(sectorEvidenceState)) return 'sector_evidence_absent';
  return 'sector_mandatory_rejection';
}

// ─── 2. Enrichment: un resultado, nunca un veredicto ──────────────────────────

/**
 * Qué pasó con el enrichment de un candidato.
 *
 * Existe para poder NOMBRAR el hecho sin que decida nada. `decideCandidateSurvival`
 * no lo recibe: ése es el trinquete estructural de este corte. Un futuro que
 * quiera volver a hacer del enrichment un gate de aceptación tendrá que cambiar
 * la FIRMA de la función, no una condición escondida en su cuerpo.
 */
export type EnrichmentCompletionOutcome =
  /** Nunca se intentó: el cap de enrichments de la corrida se agotó antes. */
  | 'not_attempted_cap_reached'
  /** Nunca se intentó: el objetivo ya estaba cubierto cuando le tocaba. */
  | 'not_attempted_target_reached'
  /** Nunca se intentó, por cualquier otra razón (o no se seleccionó). */
  | 'not_attempted'
  /** Se intentó y el proveedor no devolvió nada sobre esta empresa. */
  | 'no_match'
  /** Se intentó y devolvió datos, pero no los suficientes para confirmar. */
  | 'partial'
  /** Se intentó y falló técnicamente (timeout, error del proveedor). */
  | 'technical_failure'
  /** Se intentó y confirmó. */
  | 'confirmed';

/** Los desenlaces en los que NO llegó a ejecutarse una llamada al proveedor. */
const ENRICHMENT_NOT_ATTEMPTED_OUTCOMES: ReadonlySet<EnrichmentCompletionOutcome> = new Set([
  'not_attempted_cap_reached',
  'not_attempted_target_reached',
  'not_attempted',
]);

export function wasEnrichmentAttempted(outcome: EnrichmentCompletionOutcome): boolean {
  return !ENRICHMENT_NOT_ATTEMPTED_OUTCOMES.has(outcome);
}

// ─── 3. La decisión ───────────────────────────────────────────────────────────

/**
 * Dónde termina un candidato.
 *
 * `eligible_for_target` NO significa «cuenta hacia el objetivo»: significa
 * «puede ser EVALUADO por el contrato canónico del objetivo». Ese contrato
 * todavía puede dejarlo en `needs_review` por falta de `employee_count`, de
 * LinkedIn o de una admisión writer-only. Son dos preguntas, y ésta es la
 * primera.
 */
export type CandidateSurvivalCohort =
  /** Gates obligatorios limpios y sector CONFIRMADO. Opta al objetivo. */
  | 'eligible_for_target'
  /** Gates obligatorios limpios, evidencia sectorial AUSENTE. `needs_review`. */
  | 'survives_incomplete'
  /** Un gate obligatorio lo rechazó. No se persiste, ni siquiera a revisión. */
  | 'rejected';

export type CandidateSurvivalDecision = {
  cohort: CandidateSurvivalCohort;
  /**
   * `true` ⇔ la empresa llega al writer (como candidata completa o a revisión).
   *
   * Es EXACTAMENTE `cohort !== 'rejected'`, y se publica como campo propio
   * porque es la afirmación que el resto del sistema consume: «esta empresa no
   * desaparece».
   */
  survives: boolean;
  /** Por qué sobrevive incompleta, cuando ése es el caso. */
  incompletenessReason: 'sector_evidence_absent' | null;
  /** La causa del rechazo, tal cual llegó. Nunca inventada. */
  rejectionReason: string | null;
};

/**
 * La ÚNICA regla de supervivencia.
 *
 * Nótese lo que NO está en la firma: el proveedor, el enrichment, el cap de
 * enrichments, el objetivo, la posición del candidato en la lista y cualquier
 * señal de los catálogos propios. Ninguna de esas cosas puede rechazar a una
 * empresa, así que ninguna entra.
 *
 * `mandatoryRejection` es el veredicto YA EMITIDO por los gates obligatorios
 * (país, dominio/ownership, duplicidad, cooldown, contradicción sectorial).
 * Este módulo no los reimplementa ni los reevalúa: los respeta.
 */
export function decideCandidateSurvival(input: {
  /** Causa de rechazo de los gates obligatorios, o `null` si los pasó todos. */
  mandatoryRejection: string | null;
  /** Estado sectorial del candidato en su forma actual. */
  sectorEvidenceState: string;
}): CandidateSurvivalDecision {
  if (input.mandatoryRejection !== null) {
    return {
      cohort: 'rejected',
      survives: false,
      incompletenessReason: null,
      rejectionReason: input.mandatoryRejection,
    };
  }

  const sector = classifySectorEvidence(input.sectorEvidenceState);

  if (sector === 'sector_mandatory_rejection') {
    return {
      cohort: 'rejected',
      survives: false,
      incompletenessReason: null,
      rejectionReason: input.sectorEvidenceState,
    };
  }

  if (sector === 'sector_confirmed') {
    return {
      cohort: 'eligible_for_target',
      survives: true,
      incompletenessReason: null,
      rejectionReason: null,
    };
  }

  // Ausencia de evidencia. La empresa pasó todos los gates obligatorios: sobrevive.
  return {
    cohort: 'survives_incomplete',
    survives: true,
    incompletenessReason: 'sector_evidence_absent',
    rejectionReason: null,
  };
}

// ─── 4. Los cinco límites que `target` venía haciendo a la vez ────────────────

/**
 * Los cinco límites de una corrida, con nombre propio cada uno.
 *
 * El defecto que cierra: `targetEligibleCompanies` gobernaba a la vez la
 * PARADA del gasto —legítimo: el objetivo es lo que el usuario pidió— y el TOPE
 * del ranking final, donde recortaba empresas válidas ya encontradas y ya
 * pagadas. Una elegible en la posición 6 de una corrida con `target = 5` se
 * descartaba con `target_cap_reached` sin que ningún gate la hubiera rechazado.
 *
 * `requestedTarget` es una NECESIDAD, no un techo de existencia. Los otros
 * cuatro son límites técnicos, cada uno con su propia autoridad, y ninguno debe
 * derivarse silenciosamente de otro.
 */
export type RunCapacityLimits = {
  /** Cuántas candidatas útiles quiere el usuario. Gobierna la PARADA del gasto. */
  requestedTarget: number;
  /** Cuántos resultados por página/plan pide el proveedor. */
  providerResultLimit: number | null;
  /** Cuántos resultados crudos se admiten a evaluación. */
  rawResultLimit: number | null;
  /** Cuántos enrichments se pueden pagar en la corrida. */
  enrichmentCap: number | null;
  /** Cuántas candidatas se persisten como máximo. `null` ⇒ sin tope. */
  finalCandidateCap: number | null;
};

/**
 * Resuelve el tope de candidatas finales.
 *
 * Deliberadamente NO acepta el objetivo como parámetro: si no hay un tope
 * configurado explícitamente, no hay tope. Toda empresa que sobrevivió a los
 * gates obligatorios se persiste, y el objetivo decide cuántas CUENTAN, no
 * cuántas EXISTEN.
 *
 * Un tope explícito sigue siendo posible —un operador puede querer acotar la
 * escritura—, pero tiene que escribirse como lo que es, con su propio nombre.
 */
export function resolveFinalCandidateCap(
  configuredFinalCandidateCap: number | null | undefined,
): number | null {
  if (configuredFinalCandidateCap === null || configuredFinalCandidateCap === undefined) {
    return null;
  }
  if (!Number.isFinite(configuredFinalCandidateCap)) return null;
  return Math.max(0, Math.floor(configuredFinalCandidateCap));
}
