/**
 * lusha-quality-gate.ts — AGENT1-LUSHA-CATALOG-ADMISSION-X6.14.
 *
 * La evaluación SUSTENTADA de `quality_gate` para la ruta Lusha, en sustitución
 * del `qualityGate: 'pass'` fijo que esta pierna escribía.
 *
 * ── 🔴 Qué defecto cierra ───────────────────────────────────────────────────
 *
 * `lusha-run-acceptance-truth.ts` cableaba `qualityGate: 'pass'` con esta
 * justificación: «llegar aquí ya exige precisión macro y dedupe exacto». Eso
 * describe dos gates reales, pero `quality_gate` no estaba evaluado. Declarar
 * `pass` sin mirarlo es lo que este corte prohíbe: **una condición no evaluada
 * no puede declararse aprobada**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 LAS DOS PREGUNTAS, QUE NO SON LA MISMA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 1. **PERFIL COMERCIAL** — «¿esta empresa cumple los criterios que la usuaria
 *    pidió?». País, sector/macro y tamaño. Sus autoridades YA existen y ya
 *    corren antes que este gate:
 *      · `evaluateProspectIntakeGate`  — nombre y dominio usables, país,
 *        tamaño conocido ≥ mínimo, sector obviamente incorrecto;
 *      · `evaluateLushaCountryGate`    — el dominio sitúa a la empresa (X6.4-A);
 *      · `assessLushaMacroPrecision`   — la industria declarada pertenece a la
 *        macro pedida.
 *    **Este módulo no opina sobre el perfil comercial.** Hacerlo duplicaría una
 *    autoridad existente con una lista que la usuaria nunca eligió.
 *
 * 2. **IDENTIDAD DEL REGISTRO** — «¿esta fila representa a una EMPRESA, o es
 *    una página, un blog o un directorio que habla de empresas?». Es la única
 *    pregunta que este gate responde, y su respaldo es el mínimo obligatorio
 *    del gate compartido: un candidato necesita un NOMBRE USABLE que identifique
 *    a una empresa. Un titular de artículo o la palabra «directorio» no lo es.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE **NO** SE INCORPORA, Y POR QUÉ
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **`business_fit` NO bloquea en esta ruta, en NINGUNO de sus dos niveles.**
 *
 * Es tentador dar por buenas sus exclusiones de `reject` —agencia de marketing,
 * call center, cobranza, staffing— como si fueran universales. No lo son. Esas
 * categorías son SECTORES, y una empresa de cobranza o un call center es una
 * prospecta perfectamente legítima cuando la macro pedida los incluye. La lista
 * se escribió para un ICP de B2B tech (`Hito 16AB.43.29`: «SaaS / ERP / CRM /
 * LMS / HR Tech»), no para los criterios que la usuaria selecciona en el wizard.
 * Convertirla en política universal sería exactamente el error que la dirección
 * de producto prohíbe: la lista heredada mandando sobre los criterios elegidos.
 *
 * Su nivel `low` es peor todavía: sale de «sin señales B2B tech + una señal de
 * bajo fit», y esas señales —`distribuidora de`, `distribución de productos`,
 * `logística de distribución`, `consultora`— describen a la empresa OBJETIVO en
 * retail, consumo, logística y servicios profesionales.
 *
 * El nivel se REGISTRA como observación (`observed`) porque la decisión de
 * producto lo necesita medido, y no decide nada.
 *
 * **`external_platform` NO bloquea en esta ruta.**
 *
 * En Apollo juzga la URL de ORIGEN: dónde se encontró al candidato. Encontrarlo
 * en un marketplace o una red social no acredita a la empresa. En Lusha no hay
 * URL de origen: el dominio es el SITIO PROPIO de la empresa. Aplicarlo aquí
 * rechazaría a MercadoLibre por tener `mercadolibre.com.co`, que es justamente
 * su dominio corporativo. La misma función, sobre otro insumo, responde otra
 * pregunta — y la de aquí no tiene respaldo. Se registra como observación.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 LOS ESTADOS, Y QUÉ SIGNIFICA CADA AUSENCIA
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   · `passed`                — se evaluó y no bloquea.
 *   · `failed`                — se evaluó y bloquea.
 *   · `observed`              — se ejecutó y su resultado se publica, pero NO
 *                               decide: no hay regla de producto que lo autorice.
 *   · `not_applicable`        — la PREGUNTA no existe aquí porque el campo que
 *                               juzga no pertenece a un registro estructurado.
 *                               No rechaza por su sola ausencia.
 *   · `insufficient_evidence` — la pregunta aplica y no se pudo responder. Ni
 *                               aprobación ni contradicción.
 *
 * Y una ausencia distinta de todas ellas: que este gate NO SE HAYA EJECUTADO.
 * Eso no se representa aquí sino en el consumidor (`quality` ausente en la
 * candidata ⇒ `fail`), porque es la única ausencia que significa «evaluación
 * obligatoria que falta», y ésa sí es fail-closed.
 *
 * Aparte de los estados, un check puede responder con MENOS insumo del que
 * tendría en Apollo (`evidenceGaps`): el `snippet` y el `title` de un resultado
 * de búsqueda, que Lusha no entrega. Respondió, y con menos. Se declara.
 *
 * Puro: sin IO, sin proveedor, sin base, sin reloj.
 */

import {
  evaluateBusinessFit,
  type BusinessFitLevel,
} from '@/server/agents/prospecting-toolkit/business-fit-gate';
import { isContentPageName } from '@/server/agents/prospecting-toolkit/candidate-writer-pure-gates';
import { evaluateContentIntermediaryGate } from '@/server/agents/prospecting-toolkit/content-intermediary-gate';
import { evaluateExternalPlatformGate } from '@/server/agents/prospecting-toolkit/external-platform-blocklist';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';

/** Los checks que esta ruta nombra. Ninguno es nuevo: todos existen. */
export const LUSHA_QUALITY_CHECKS = [
  'content_intermediary_gate',
  'content_page_name_gate',
  'external_platform_gate',
  'business_fit_gate',
  'source_url_quality_gate',
] as const;

export type LushaQualityCheck = (typeof LUSHA_QUALITY_CHECKS)[number];

export type LushaQualityCheckState =
  | 'passed'
  | 'failed'
  | 'observed'
  | 'not_applicable'
  | 'insufficient_evidence';

/**
 * Insumos que el contrato de Lusha NO entrega. Un check que los usaría responde
 * igual, con menos evidencia, y lo declara.
 */
export const LUSHA_ABSENT_EVIDENCE = ['source_snippet', 'source_title'] as const;

export type LushaAbsentEvidence = (typeof LUSHA_ABSENT_EVIDENCE)[number];

export type LushaQualityCheckOutcome = {
  readonly check: LushaQualityCheck;
  readonly state: LushaQualityCheckState;
  /** Motivo VERBATIM del gate, o la causa del estado no decisorio. */
  readonly detail: string | null;
  /** 🔴 ¿Este check puede DECIDIR en esta ruta? Lo fija la regla, no el resultado. */
  readonly decides: boolean;
  /** Evidencia que habría usado y que esta ruta no tiene. */
  readonly evidenceGaps: readonly LushaAbsentEvidence[];
};

/**
 * 🔴 Tres veredictos, no dos.
 *
 * `unknown` existe para no inventar: la pregunta de identidad aplica y no se
 * pudo responder. No aprueba y no contradice; el consumidor la trata como
 * condición NO DISPONIBLE, que no satisface el contrato pero tampoco acusa.
 */
export type LushaQualityVerdict = 'pass' | 'fail' | 'unknown';

export type LushaQualityGateResult = {
  readonly verdict: LushaQualityVerdict;
  /** El check que bloqueó, para el motivo durable. `null` ⇒ ninguno. */
  readonly blockingCheck: LushaQualityCheck | null;
  readonly blockingReason: string | null;
  readonly checks: readonly LushaQualityCheckOutcome[];
  /** El nivel CRUDO de `evaluateBusinessFit`. Se publica; no decide. */
  readonly businessFitLevel: BusinessFitLevel;
  /**
   * 🔴 `false` por construcción: esta ruta NO responde todo lo que Apollo
   * responde. Es documentación — no sustituye la evaluación ni decide si una
   * candidata cuenta. Lo que decide es `verdict`.
   */
  readonly parityComplete: false;
};

export type LushaQualityGateInput = {
  readonly name: string | null;
  /** `domain` de Lusha, que puede venir como host o como URL entera. */
  readonly domain: string | null;
};

/**
 * 🔴 `source_url_quality` no aplica, y la razón es del CONTRATO del proveedor:
 * clasifica la calidad de la URL de un RESULTADO DE BÚSQUEDA —profundidad de
 * ruta, si es una nota, si es un listado—. Lusha devuelve un registro
 * estructurado con dominio raíz. No hay URL de origen que clasificar, y su
 * ausencia no es motivo de rechazo.
 */
const SOURCE_URL_QUALITY_NOT_APPLICABLE =
  'structured_record_has_no_source_url_to_classify';

/** `external_platform` sin respaldo aquí: juzgaría el dominio PROPIO. */
const EXTERNAL_PLATFORM_NOT_AUTHORIZED =
  'judges_source_url_in_apollo_but_own_domain_here';

/** `business_fit` sin respaldo aquí: es un ICP fijo, no los criterios pedidos. */
const BUSINESS_FIT_NOT_AUTHORIZED = 'fixed_b2b_tech_icp_not_the_requested_criteria';

/** Evalúa la identidad del registro de UNA empresa de Lusha. */
export function evaluateLushaQualityGate(
  input: LushaQualityGateInput,
): LushaQualityGateResult {
  const name = (input.name ?? '').trim();
  // El MISMO normalizador que usan el gate de país y el de ownership de esta
  // ruta: `domain` puede llegar como URL entera.
  const domain = input.domain === null ? null : normalizeDomain(input.domain);
  const website = domain === null ? null : `https://${domain}`;

  const checks: LushaQualityCheckOutcome[] = [];
  let blockingCheck: LushaQualityCheck | null = null;
  let blockingReason: string | null = null;
  let evidenceMissing = false;

  const record = (
    check: LushaQualityCheck,
    state: LushaQualityCheckState,
    detail: string | null,
    options: { decides: boolean; evidenceGaps?: readonly LushaAbsentEvidence[] },
  ): void => {
    checks.push({
      check,
      state,
      detail,
      decides: options.decides,
      evidenceGaps: options.evidenceGaps ?? [],
    });
    if (!options.decides) return;
    if (state === 'failed' && blockingCheck === null) {
      blockingCheck = check;
      blockingReason = detail;
    }
    if (state === 'insufficient_evidence') evidenceMissing = true;
  };

  // 🔴 Sin nombre usable la pregunta de identidad no se puede responder. No es
  // un rechazo —el gate compartido ya excluye `missing_name` antes de llegar
  // aquí— y tampoco un pase: es evidencia insuficiente.
  const identityAnswerable = name !== '';

  // ── 1. Intermediario de contenido — DECIDE ────────────────────────────────
  //
  // Respaldo: el mínimo obligatorio de NOMBRE USABLE del gate compartido. Un
  // blog, un portal o un directorio no son la empresa que se busca.
  //
  // 🔴 `title`/`snippet` se omiten porque Lusha no los produce; fabricarlos
  // sería inventar evidencia. Sin ellos, el gate decide por nombre y dominio,
  // que es el insumo que un registro estructurado sí tiene.
  if (identityAnswerable) {
    const intermediary = evaluateContentIntermediaryGate({ name, domain });
    record(
      'content_intermediary_gate',
      intermediary.blocked ? 'failed' : 'passed',
      intermediary.blocked
        ? (intermediary.reasons[0] ?? 'content_or_intermediary_site')
        : null,
      { decides: true, evidenceGaps: ['source_snippet', 'source_title'] },
    );
  } else {
    record('content_intermediary_gate', 'insufficient_evidence', 'name_absent', {
      decides: true,
    });
  }

  // ── 2. Nombre de página de contenido — DECIDE ─────────────────────────────
  //
  // Mismo respaldo. Sólo la mitad de NOMBRE: `isContentPageUrl` juzga la RUTA de
  // una URL y un dominio raíz no tiene ruta, así que esa mitad no se ejecuta en
  // vez de ejecutarse para devolver un `false` que no afirma nada.
  if (identityAnswerable) {
    const contentPageName = isContentPageName(name);
    record(
      'content_page_name_gate',
      contentPageName ? 'failed' : 'passed',
      contentPageName ? 'content_page_name' : null,
      { decides: true },
    );
  } else {
    record('content_page_name_gate', 'insufficient_evidence', 'name_absent', {
      decides: true,
    });
  }

  // ── 3. Plataforma externa — SE OBSERVA, NO DECIDE ─────────────────────────
  const externalPlatform = evaluateExternalPlatformGate(website, name || null);
  record(
    'external_platform_gate',
    'observed',
    externalPlatform.allowed
      ? null
      : `${EXTERNAL_PLATFORM_NOT_AUTHORIZED}:${externalPlatform.platformType ?? 'unknown'}`,
    { decides: false },
  );

  // ── 4. Encaje de negocio — SE OBSERVA, NO DECIDE ──────────────────────────
  const businessFit = evaluateBusinessFit({
    name,
    website,
    domain,
    // Sin snippet ni título: Lusha no los entrega. Su ausencia deja mudas las
    // señales de snippet, que es el hecho y no un descuido.
    sourceSnippet: null,
    sourceTitle: null,
    subindustries: [],
    additionalCriteria: null,
  });
  record('business_fit_gate', 'observed', `${BUSINESS_FIT_NOT_AUTHORIZED}:${businessFit.fit}`, {
    decides: false,
    evidenceGaps: ['source_snippet', 'source_title'],
  });

  // ── 5. Calidad de la URL de origen — NO APLICA ────────────────────────────
  record('source_url_quality_gate', 'not_applicable', SOURCE_URL_QUALITY_NOT_APPLICABLE, {
    decides: false,
  });

  const verdict: LushaQualityVerdict =
    blockingCheck !== null ? 'fail' : evidenceMissing ? 'unknown' : 'pass';

  return {
    verdict,
    blockingCheck,
    blockingReason,
    checks,
    businessFitLevel: businessFit.fit,
    parityComplete: false,
  };
}

/** Bloque durable por candidata. Acotado, sin PII y sin payload del proveedor. */
export function toLushaQualityGateMetadata(
  result: LushaQualityGateResult,
): Record<string, unknown> {
  return {
    verdict: result.verdict,
    blocking_check: result.blockingCheck,
    blocking_reason: result.blockingReason,
    business_fit_level: result.businessFitLevel,
    checks: result.checks.map((check) => ({
      check: check.check,
      state: check.state,
      // 🔴 Qué DECIDIÓ y qué sólo se miró: sin esto, un `observed` se leería como
      // un veredicto y la fila afirmaría algo que el producto no autorizó.
      decides: check.decides,
      detail: check.detail,
      // «No aplica» y «respondí con menos evidencia» son cosas distintas: la
      // primera está en `state`, la segunda aquí.
      evidence_gaps: [...check.evidenceGaps],
    })),
    parity_with_apollo_quality_gate_complete: false,
  };
}
