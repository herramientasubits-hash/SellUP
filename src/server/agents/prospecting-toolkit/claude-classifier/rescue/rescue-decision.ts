/**
 * Agente 1 · Rescate con Claude — la decisión (puro).
 *
 * Regla de la dueña (30-09): los filtros descartan solos lo que no cumple.
 * Si Claude completa los datos que faltaban y la empresa PASA los mismos
 * filtros (sector del lote y tamaño ≥ umbral ICP), va a «Candidatos por
 * revisar»; si NO pasa, va a «Descartadas» con el motivo y la fuente.
 * Nada se aprueba solo.
 *
 * Asimetría deliberada: para DESCARTAR hace falta una cita comprobada
 * (`quote_verified`). Una fuente sólo listada puede completar un dato —una
 * persona lo revisa igual—, pero nunca hacer desaparecer una empresa.
 */

import type { CompanyClassificationResult } from '../types';

/** Umbral ICP por defecto (el mismo del asistente: > 200 colaboradores). */
export const DEFAULT_ICP_MIN_EMPLOYEES = 200;

export type RescueDiscardReason = 'claude_sector_mismatch' | 'claude_size_below_min';

export type RescueDecision =
  | {
      kind: 'discard';
      reason: RescueDiscardReason;
      /** Frase para la pestaña Descartadas. */
      detail: string;
      sourceUrl: string;
    }
  | {
      /**
       * Completa lo que se pudo confirmar. Una fila de Descartadas sólo vuelve a
       * revisión si el SECTOR quedó confirmado (se había descartado por eso).
       */
      kind: 'admit';
      sectorConfirmed: boolean;
      sizeConfirmed: boolean;
      linkedinConfirmed: boolean;
      /** Claude vio OTRO sector pero sin evidencia suficiente para descartar: aviso a la revisora. */
      sectorMismatchUnconfirmed?: boolean;
    }
  | {
      /**
       * Decisión de la dueña (01-10): la empresa es de OTRA macroindustria del
       * catálogo (cita comprobada, la misma exigencia que para descartar) pero
       * encaja con UBITS (≥ umbral ICP). No se descarta: vuelve a «Candidatos por
       * revisar» del mismo vendedor con la industria corregida, y NO cuenta para
       * la meta de la búsqueda (no es lo que se pidió).
       */
      kind: 'reassign';
      industryId: string;
      industryName: string;
      /** Frase para la nota de revisión. */
      detail: string;
      sourceUrl: string;
      sizeConfirmed: boolean;
      linkedinConfirmed: boolean;
    }
  | {
      kind: 'unchanged';
      why: 'nothing_verifiable' | 'sector_unknown' | 'not_classified';
      sectorMismatchUnconfirmed?: boolean;
    };

export type RescueContext = {
  icpMinEmployees: number;
  /** Nombre de la macroindustria pedida en la búsqueda (para no descartar si la cita la nombra). */
  requestedIndustryName?: string | null;
  /** El tamaño ya viene confirmado por el proveedor (p. ej. Lusha): Claude no lo contradice. */
  sizeAlreadyConfirmed?: boolean;
  /**
   * SOURCES-EC-CLOSE-2 — el tamaño lo midió la fuente OFICIAL de la capa gratuita
   * (`officialSizeSignal`): cuenta como dato confirmado para pasar a revisión.
   */
  officialSizeMeasured?: boolean;
  /**
   * El filtro ICP del asistente ya dejó pasar la fila por tamaño (`icp_size_gate.decision='pass'`).
   * Sólo sirve para REASIGNAR la industria: no resuelve la condición de tamaño de la meta.
   */
  sizePassedIcpGate?: boolean;
};

/**
 * Confianza mínima de Claude para DESCARTAR. Prod 30-09: MASPLAY se descartó con
 * 0,7 aunque su sitio dice «EMPRESA DE TECNOLOGIA»; el resto de descartes correctos
 * venían con 0,9–0,95.
 */
export const MIN_DISCARD_CONFIDENCE = 0.8;

/**
 * Descarte con cita que viene de la BÚSQUEDA (no se pudo comprobar en el sitio
 * de la empresa): sólo con confianza muy alta. Decisión de la dueña 30-09 («no
 * quiero hacer nada manual»): KFC, COSCO, mineras, medios quedaban con aviso.
 * Sigue siendo reversible desde Descartadas → «Enviar a revisión».
 */
export const MIN_DISCARD_CONFIDENCE_SEARCH_SOURCE = 0.95;

function stems(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5)
    .map((w) => w.slice(0, 7));
}

/** ¿La cita nombra la industria pedida? («empresa de tecnología» en un lote de Tecnología). */
export function quoteNamesIndustry(quote: string, industryName: string | null | undefined): boolean {
  if (!industryName) return false;
  const quoteText = quote.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return stems(industryName).some((stem) => quoteText.includes(stem));
}

function isSafeNegativeEvidence(
  evidence: { verification: string; confidence: number; quote: string },
  ctx: RescueContext,
): boolean {
  if (quoteNamesIndustry(evidence.quote, ctx.requestedIndustryName)) return false;
  if (evidence.verification === 'quote_verified') return evidence.confidence >= MIN_DISCARD_CONFIDENCE;
  if (evidence.verification === 'source_listed') return evidence.confidence >= MIN_DISCARD_CONFIDENCE_SEARCH_SOURCE;
  return false;
}

/**
 * Dos señales: la macroindustria del catálogo que eligió Claude y su respuesta
 * directa «¿pertenece a la industria buscada?». La segunda existe porque hay
 * empresas que no encajan en NINGUNA de las 12 macros (medios, Prod 30-09):
 * sin ella no había veredicto. Si las dos señales se contradicen, no se decide.
 */
function sectorVerdict(result: CompanyClassificationResult, ctx: RescueContext): 'pass' | 'fail' | 'unknown' {
  const sector = result.sector;
  const fit = result.requestedIndustryFit ?? null;
  const catalogSays = !sector || sector.matchesCurrentIndustry === null ? null : sector.matchesCurrentIndustry;
  const fitSays = fit ? fit.fits : null;
  if (catalogSays !== null && fitSays !== null && catalogSays !== fitSays) return 'unknown';

  if (catalogSays === true) return 'pass';
  if (fitSays === true && fit!.verification === 'quote_verified') return 'pass';

  if (catalogSays === false && sector && isSafeNegativeEvidence(sector, ctx)) return 'fail';
  if (fitSays === false && fit && isSafeNegativeEvidence(fit, ctx)) return 'fail';
  return 'unknown';
}

/**
 * Confianza mínima para DESCARTAR por tamaño (decisión de la dueña 02-10). Casi todos los
 * tamaños vienen de LinkedIn («De 11 a 50 empleados»), que Claude ve en la búsqueda pero
 * no puede citar textual (`source_listed`): con la regla anterior (sólo `quote_verified`
 * ≥ 0,8) quedaban en revisión ~25 empresas de 2 a 150 empleados (Prod 02-10).
 */
export const MIN_SIZE_DISCARD_CONFIDENCE_QUOTE = 0.6;
export const MIN_SIZE_DISCARD_CONFIDENCE_SEARCH_SOURCE = 0.85;

/** ¿Este rango demuestra, con suficiente confianza, que la empresa está bajo el umbral? */
export function rangeProvesBelowThreshold(
  range: { max: number | null; verification: string; confidence: number },
  threshold: number,
): boolean {
  if (range.max === null || range.max <= 0 || range.max >= threshold) return false;
  if (range.verification === 'quote_verified') return range.confidence >= MIN_SIZE_DISCARD_CONFIDENCE_QUOTE;
  if (range.verification === 'source_listed') return range.confidence >= MIN_SIZE_DISCARD_CONFIDENCE_SEARCH_SOURCE;
  return false;
}

function sizeVerdict(result: CompanyClassificationResult, ctx: RescueContext): 'pass' | 'fail' | 'unknown' {
  if (ctx.sizeAlreadyConfirmed) return 'unknown';
  const range = result.employeeRange;
  if (!range) return 'unknown';
  if (range.min >= ctx.icpMinEmployees) return 'pass';
  // Otro proveedor ya lo dejó pasar por tamaño: Claude no lo contradice para descartar.
  if (ctx.sizePassedIcpGate) return 'unknown';
  return rangeProvesBelowThreshold(range, ctx.icpMinEmployees) ? 'fail' : 'unknown';
}

/**
 * Filas YA clasificadas (con otra regla): si lo guardado demuestra que está bajo el umbral,
 * se descarta sin volver a llamar a Claude. Sólo filas sin tamaño de otro proveedor.
 */
export function storedSmallSizeDiscard(
  metadata: Record<string, unknown> | null,
  threshold: number,
): Extract<RescueDecision, { kind: 'discard' }> | null {
  const gate = metadata?.icp_size_gate as { size_status?: unknown; decision?: unknown } | undefined;
  const status = typeof gate?.size_status === 'string' ? gate.size_status : 'unknown';
  if (status.startsWith('confirmed') || status.startsWith('estimated') || gate?.decision === 'pass') return null;
  const range = (metadata?.claude_classification as { employee_range?: unknown } | undefined)?.employee_range as
    | { min?: unknown; max?: unknown; verification?: unknown; confidence?: unknown; quote?: unknown; source_url?: unknown }
    | null
    | undefined;
  if (!range || typeof range.quote !== 'string' || typeof range.source_url !== 'string') return null;
  const parsed = {
    max: typeof range.max === 'number' ? range.max : null,
    verification: typeof range.verification === 'string' ? range.verification : 'rejected',
    confidence: typeof range.confidence === 'number' ? range.confidence : 0,
  };
  if (!rangeProvesBelowThreshold(parsed, threshold)) return null;
  return {
    kind: 'discard',
    reason: 'claude_size_below_min',
    detail: `Según Claude tiene menos de ${threshold} empleados: «${range.quote.slice(0, 160)}»`,
    sourceUrl: range.source_url,
  };
}

/**
 * Decisión de la dueña (02-10): los MEDIOS de comunicación (diarios, TV, radio) se
 * descartan siempre, aunque Claude los ponga en otra macro del catálogo («Compañía de
 * Servicios», «Gobierno»). Sólo frases inequívocas: «canal», «tv», «radio», «prensa» o «diario»
 * sueltas daban falsos positivos (canales de venta, prensas hidráulicas, consumo diario).
 */
const MEDIA_PATTERN =
  /\b(medios? de comunicacion|diarios? (de|del) (noticias|circulacion|mayor circulacion)|periodicos?|canal(es)? de (television|tv)|television|televisora|emisoras?( de radio)?|estacion(es)? de radio|radiodifus\w*|cadena de radio|noticias|newspapers?|broadcast\w*|tv channel|news media)\b/;

function normalizeForMatch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Telecom NO es medio (decisión de la dueña 30-09: telecom/ISP = Tecnología). Prod
 * 02-10: HV Multiplay «servicios de internet, televisión y telefonía».
 */
const TELECOM_PATTERN = /\b(telecomunicacion\w*|telefonia|(servicios?|proveedor(es)?|proveedora) de internet|fibra optica|operador(a)? de cable)\b/;

/** ¿La evidencia describe a un medio de comunicación (y no a una telecom)? */
export function looksLikeMediaCompany(quotes: ReadonlyArray<string | null | undefined>): boolean {
  const texts = quotes.filter((q): q is string => typeof q === 'string').map(normalizeForMatch);
  if (texts.some((t) => TELECOM_PATTERN.test(t))) return false;
  return texts.some((t) => MEDIA_PATTERN.test(t));
}

export function decideRescue(result: CompanyClassificationResult, ctx: RescueContext): RescueDecision {
  if (result.outcome !== 'classified' && result.outcome !== 'partially_classified') {
    return { kind: 'unchanged', why: result.outcome === 'nothing_verifiable' ? 'nothing_verifiable' : 'not_classified' };
  }
  const sector = sectorVerdict(result, ctx);
  const size = sizeVerdict(result, ctx);

  if (sector === 'fail') {
    const bySector = result.sector && result.sector.matchesCurrentIndustry === false ? result.sector : null;
    // Otra macro del catálogo + tamaño UBITS ⇒ se corrige la industria en vez de descartar.
    // Sin macro (p. ej. medios, Prod 30-09) no hay industria a la que pasarla: se descarta.
    const sizeFitsUbits = size === 'pass' || ctx.sizeAlreadyConfirmed === true || ctx.sizePassedIcpGate === true;
    const isMedia = looksLikeMediaCompany([bySector?.quote, result.requestedIndustryFit?.quote]);
    if (bySector && bySector.industryId && sizeFitsUbits && !isMedia) {
      const from = ctx.requestedIndustryName ? `Buscada en ${ctx.requestedIndustryName}, ` : '';
      return {
        kind: 'reassign',
        industryId: bySector.industryId,
        industryName: bySector.industryName,
        detail: `${from}según Claude es ${bySector.industryName}: «${bySector.quote.slice(0, 160)}»`,
        sourceUrl: bySector.sourceUrl,
        sizeConfirmed: size === 'pass',
        linkedinConfirmed: !!result.linkedin,
      };
    }
    const evidence = bySector ?? result.requestedIndustryFit!;
    const what = bySector ? `es ${bySector.industryName}` : `no es ${ctx.requestedIndustryName ?? 'de la industria buscada'}`;
    return {
      kind: 'discard',
      reason: 'claude_sector_mismatch',
      detail: `Según Claude ${what}: «${evidence.quote.slice(0, 160)}»`,
      sourceUrl: evidence.sourceUrl,
    };
  }
  if (size === 'fail' && result.employeeRange) {
    return {
      kind: 'discard',
      reason: 'claude_size_below_min',
      detail: `Según Claude tiene menos de ${ctx.icpMinEmployees} empleados: «${result.employeeRange.quote.slice(0, 160)}»`,
      sourceUrl: result.employeeRange.sourceUrl,
    };
  }
  const linkedinConfirmed = !!result.linkedin;
  const sectorMismatchUnconfirmed =
    sector === 'unknown' &&
    (result.sector?.matchesCurrentIndustry === false || result.requestedIndustryFit?.fits === false);
  // SOURCES-EC-CLOSE-2 — el tamaño medido por la fuente OFICIAL (capa gratuita de EC,
  // CL, RD) también es un dato confirmado: antes se le pedía a Claude no decidir por
  // tamaño y, con eso, la empresa grande se quedaba en Descartadas si la web no decía
  // el sector (Prod 06-10, EC×Tec 0ef658fd: Cartimex, Computron, Movilcelistic con web
  // correcta). Pasa a revisión con el aviso de sector sin confirmar.
  if (sector !== 'pass' && size !== 'pass' && !ctx.officialSizeMeasured && !linkedinConfirmed) {
    return { kind: 'unchanged', why: 'sector_unknown', ...(sectorMismatchUnconfirmed ? { sectorMismatchUnconfirmed } : {}) };
  }
  return {
    kind: 'admit',
    sectorConfirmed: sector === 'pass',
    sizeConfirmed: size === 'pass',
    linkedinConfirmed,
    ...(sectorMismatchUnconfirmed ? { sectorMismatchUnconfirmed } : {}),
  };
}
