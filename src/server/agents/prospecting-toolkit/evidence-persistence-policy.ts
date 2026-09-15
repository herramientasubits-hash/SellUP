/**
 * Evidence Persistence Policy — Hito v1.5 / X6.2-A
 *
 * Política source-first/evidence-first: decide qué se puede AFIRMAR de un
 * candidato a partir de:
 *   - country_evidence: strong / query_only / weak
 *   - business_fit:    high / medium / low / reject
 *
 * Sin IA. Sin llamadas externas. Determinístico.
 *
 * ── 🔴 AGENT1-COUNTRY-EVIDENCE-CONTRACT-X6.2-A ───────────────────────────────
 *
 * Esta política dejó de decidir SUPERVIVENCIA.
 *
 * El defecto que cierra, medido en el lote `f6cad05f-570f-4791-8879-4c803932349b`
 * (CO × Retail × target 5, Apollo forzado, `main` con X6.1 dentro): 34 empresas
 * únicas, 19 llegaron al gate de ownership, 14 lo pasaron —`allowed: true` en
 * las 14— y NUEVE murieron aquí con `evidence_policy:
 * no_country_evidence_with_weak_fit`. Ninguna de las nueve tenía evidencia EN
 * CONTRA de estar en Colombia: `country_rejected = 0` en toda la corrida, y
 * `gap_causes = {"evidence_policy": 9}` — el hueco entero del lote era este gate.
 *
 * Lo decisivo no es el número, es lo que decían sus propias filas de
 * `prospect_discarded_dispositions`:
 *
 *     disposition                = final_validation_rejected
 *     original_final_disposition = persisted_review_only_final              (7)
 *                                = provisionally_persisted_pending_writer_final (2)
 *
 * El orquestador YA HABÍA DECIDIDO que las nueve se persistían —siete a la
 * cohorte de revisión, dos como candidatas plenas— y esta política revirtió esa
 * decisión aguas abajo. Eso es exactamente lo que `candidate-survival.ts`
 * prohíbe desde X5: los gates OBLIGATORIOS deciden quién sobrevive; todo lo
 * demás COMPLETA, y su ausencia es ausencia de evidencia, no evidencia en
 * contra. X5 lo arregló para el eje SECTOR; el eje PAÍS quedó sin migrar y
 * mataba DESPUÉS de que la supervivencia ya estaba concedida.
 *
 * Dos empresas lo pagaron con crédito: `caribesupermercados.co` y
 * `tiendaprimavera.com` habían ejecutado su enrichment (1 crédito cada una) y
 * murieron igual. Gastar no las salvó — la misma firma de artefacto que X5.2
 * describió para `sector_not_mapped`.
 *
 * ── Las SEIS preguntas, cada una con su propio campo ─────────────────────────
 *
 * El trinquete estructural de este corte: mezclarlas otra vez exige cambiar la
 * FIRMA del resultado, no una condición escondida en el cuerpo.
 *
 *   1. ¿Puede SOBREVIVIR?          ya NO se responde aquí. La deciden los gates
 *                                  obligatorios —y para el país, la
 *                                  CONTRADICCIÓN que emite
 *                                  `evaluateCountryCompatibility`, anterior a
 *                                  esta política en el writer.
 *   2. ¿Está RESPALDADO el país?   `countryEvidence.evidenceLevel`, que se
 *                                  reporta y no castiga.
 *   3. ¿Debe PERSISTIRSE?          sobrevivir ⇒ persistir.
 *   4. ¿Queda en REVISIÓN?         `incompletenessReason`, que nombra la causa.
 *   5. ¿Autoriza GASTO?            `paidCompletionAuthorized`.
 *   6. ¿Cuenta hacia el OBJETIVO?  `targetAcceptanceAuthorized`.
 *
 * Las respuestas 5 y 6 son DELIBERADAMENTE las de antes del corte, rama por
 * rama. Ahí está la prueba de que X6.2-A no puede abrir gasto ni fabricar
 * aceptaciones: de las seis preguntas sólo cambia la primera, que era la única
 * que estaba mal. «Sobrevivir no es cobrar» (X5.2), y aquí además «sobrevivir no
 * es contar».
 */

import type { BusinessFitResult } from './business-fit-gate';
import type { CountryEvidenceResult } from './country-evidence-gate';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/**
 * `blocked` sigue en la unión y NINGUNA regla lo produce hoy.
 *
 * Queda RESERVADO para evidencia CONTRARIA, que esta política no emite: la
 * contradicción de país la decide `evaluateCountryCompatibility` antes de
 * llegar aquí. Se conserva —en vez de borrarse— porque el writer mantiene su
 * punto de aplicación, y borrar la variante obligaría a reintroducirla el día
 * que exista una regla de contradicción propia. Que no sea alcanzable desde el
 * eje país es un invariante con test propio (T10).
 */
export type EvidencePersistenceDecision = 'blocked' | 'needs_review' | 'ok';

/**
 * 🔴 X6.2-A — por qué un candidato sobrevive INCOMPLETO.
 *
 * `null` ⇒ no le falta nada que esta política sepa nombrar. El vocabulario es
 * cerrado a propósito: un hueco sin nombre no puede viajar a la fila.
 */
export type EvidencePersistenceIncompletenessReason = 'country_evidence_absent';

export type EvidencePersistencePolicyResult = {
  /** Decisión de CALIDAD de la afirmación. Ya no decide supervivencia. */
  decision: EvidencePersistenceDecision;
  /**
   * Cap máximo de confidence_score (0-100). null = sin modificación.
   * Se aplica antes de escribir para que la UI muestre confianza real,
   * no la inflada por país inferido de la query.
   */
  confidenceCap: number | null;
  /** Warnings a incluir en metadata.evidence_policy del candidato. */
  warnings: string[];
  /** Código de razón primaria (para metadata y trazabilidad). */
  primaryReason: string;
  /**
   * True cuando recommended_action debe forzarse a 'review_manually'.
   * Sobreescribe el valor del scorer si viene inflado.
   *
   * 🔴 X6.2-A — hasta este corte el campo se serializaba y NADIE lo leía: el
   * `recommended_action` salía siempre del scorer reconciliado. Un campo que
   * promete forzar revisión y no la fuerza era la mitad decorativa de esta
   * política. Ahora el writer lo aplica.
   */
  forceReviewManually: boolean;
  /**
   * 🔴 X6.2-A · pregunta 5 — ¿puede esta candidata consumir COMPLETADO PAGADO?
   *
   * `false` reproduce, rama por rama, exactamente los casos que antes devolvían
   * `decision: 'blocked'`, porque ése era el booleano que
   * `linkedin-company-search.ts` y `rich-profile-enrichment.ts` leían para
   * saltar sin llamar al proveedor. Sobrevivir no es cobrar: que una empresa
   * deje de desaparecer no le abre ni un crédito.
   */
  paidCompletionAuthorized: boolean;
  /**
   * 🔴 X6.2-A · pregunta 6 — ¿puede CONTAR hacia el objetivo del usuario?
   *
   * `false` reproduce, rama por rama, los casos que antes devolvían `blocked`,
   * porque ése era el único valor que hacía `qualityGate: 'fail'` en el
   * contrato canónico. Una empresa cuya pertenencia al país no está demostrada
   * se persiste para que una persona la revise, pero NO se entrega como
   * candidata del país pedido.
   */
  targetAcceptanceAuthorized: boolean;
  /** 🔴 X6.2-A · pregunta 4 — por qué sobrevive incompleta, o `null`. */
  incompletenessReason: EvidencePersistenceIncompletenessReason | null;
};

export type EvidencePersistencePolicyInput = {
  countryEvidence: CountryEvidenceResult;
  businessFit: BusinessFitResult;
};

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Computa la política de persistencia evidence-first.
 *
 * Orden de evaluación (primero gana):
 *
 * R1: country_evidence = query_only
 *     → needs_review, confidence capped at 45, forceReviewManually
 *     Razón: el país solo aparece en la query; el sitio no confirma presencia local.
 *     No se bloquea (puede ser empresa real) pero tampoco puede tener alta confianza.
 *
 * R2: country_evidence = weak + businessFit = medium/low
 *     → 🔴 X6.2-A: needs_review INCOMPLETO. Antes: `blocked`.
 *     Razón: no hay evidencia de país — ni a favor ni en contra. La empresa pasó
 *     los gates obligatorios, así que sobrevive; pero no cuenta hacia el
 *     objetivo y no autoriza gasto.
 *
 * R3: country_evidence = weak + businessFit = high
 *     → needs_review, confidence capped at 40, forceReviewManually
 *
 * R4: country_evidence = strong + businessFit = high
 *     → ok (mejor candidato; sin modificaciones)
 *
 * Default: needs_review sin cap (conservador)
 */
export function computeEvidencePersistencePolicy(
  input: EvidencePersistencePolicyInput,
): EvidencePersistencePolicyResult {
  const { countryEvidence, businessFit } = input;
  const warnings: string[] = [];

  if (countryEvidence.warning) {
    warnings.push(countryEvidence.warning);
  }

  // R1: Solo evidencia de país en la query
  if (countryEvidence.evidenceLevel === 'query_only') {
    warnings.push(
      'País no confirmado por evidencia del sitio — solo presente en la query de búsqueda. ' +
      'No se puede asignar confianza alta.',
    );
    return {
      decision: 'needs_review',
      confidenceCap: 45,
      warnings,
      primaryReason: 'country_evidence_query_only',
      forceReviewManually: true,
      // Antes de X6.2-A esta rama NO era `blocked`: ni bloqueaba gasto ni
      // impedía contar. Se declara explícito para que siga siendo verdad.
      paidCompletionAuthorized: true,
      targetAcceptanceAuthorized: true,
      incompletenessReason: null,
    };
  }

  // R2: Sin evidencia de país + fit no fuerte
  //
  // 🔴 X6.2-A — aquí vivía `decision: 'blocked'`, y con ella el `continue` del
  // writer que borraba la fila. La condición sobre el fit era además
  // decorativa: `isBlockedByBusinessFit` ya descartó `low` y `reject` río
  // arriba, así que cuando esta política corre el fit sólo puede ser `high` o
  // `medium`, y `high` es inalcanzable fuera del segmento B2B tech al que está
  // cableado `business-fit-gate`. En cualquier macro no tecnológica la regla
  // era, literalmente, «sin dominio .com.co no existes»: las cinco filas que el
  // lote `f6cad05f…` sí persistió son exactamente las cinco con `.com.co`.
  if (
    countryEvidence.evidenceLevel === 'weak' &&
    (businessFit.fit === 'medium' || businessFit.fit === 'low')
  ) {
    warnings.push(
      'Sin evidencia de país en URL, dominio, snippet ni título. ' +
      'Ausencia de evidencia, no evidencia en contra: el candidato se persiste ' +
      'para revisión manual, no cuenta hacia el objetivo y no autoriza gasto.',
    );
    return {
      decision: 'needs_review',
      confidenceCap: 40,
      warnings,
      // El nombre anterior —`no_country_evidence_with_weak_fit`— afirmaba un
      // veredicto sobre la empresa. Éste describe nuestro hueco, que es lo único
      // que la corrida sabe.
      primaryReason: 'country_evidence_absent_survives_incomplete',
      forceReviewManually: true,
      paidCompletionAuthorized: false,
      targetAcceptanceAuthorized: false,
      incompletenessReason: 'country_evidence_absent',
    };
  }

  // R3: Sin evidencia de país + fit alto → needs_review con cap reducido
  if (countryEvidence.evidenceLevel === 'weak') {
    warnings.push(
      'País sin evidencia directa en el sitio. ' +
      'Empresa con señales de fit B2B pero sin confirmación geográfica.',
    );
    return {
      decision: 'needs_review',
      confidenceCap: 40,
      warnings,
      primaryReason: 'no_country_evidence_high_fit',
      forceReviewManually: true,
      // Igual que R1: antes de X6.2-A esta rama no era `blocked`. No se aprieta
      // ni se afloja — se declara.
      paidCompletionAuthorized: true,
      targetAcceptanceAuthorized: true,
      incompletenessReason: null,
    };
  }

  // R4: Evidencia fuerte + fit alto → candidato sólido
  if (countryEvidence.evidenceLevel === 'strong' && businessFit.fit === 'high') {
    return {
      decision: 'ok',
      confidenceCap: null,
      warnings,
      primaryReason: 'strong_evidence_high_fit',
      forceReviewManually: false,
      paidCompletionAuthorized: true,
      targetAcceptanceAuthorized: true,
      incompletenessReason: null,
    };
  }

  // Default: conservador
  return {
    decision: 'needs_review',
    confidenceCap: null,
    warnings,
    primaryReason: 'default_conservative',
    forceReviewManually: false,
    paidCompletionAuthorized: true,
    targetAcceptanceAuthorized: true,
    incompletenessReason: null,
  };
}

/**
 * 🔴 X6.2-A — el predicado que consumen los DOS puntos de gasto del writer.
 *
 * Existe como función con nombre —y no como una comparación suelta repetida dos
 * veces— porque es la afirmación que separa este corte de una regresión de
 * coste: si alguien vuelve a derivar el gasto de `decision`, tiene que borrar
 * esta función y sus llamadas, no cambiar un `===` escondido.
 */
export function isPaidCompletionBlockedByEvidencePolicy(
  result: EvidencePersistencePolicyResult,
): boolean {
  return !result.paidCompletionAuthorized;
}
