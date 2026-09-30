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
};

/**
 * Confianza mínima de Claude para DESCARTAR. Prod 30-09: MASPLAY se descartó con
 * 0,7 aunque su sitio dice «EMPRESA DE TECNOLOGIA»; el resto de descartes correctos
 * venían con 0,9–0,95.
 */
export const MIN_DISCARD_CONFIDENCE = 0.8;

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
  return (
    evidence.verification === 'quote_verified' &&
    evidence.confidence >= MIN_DISCARD_CONFIDENCE &&
    !quoteNamesIndustry(evidence.quote, ctx.requestedIndustryName)
  );
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

function sizeVerdict(result: CompanyClassificationResult, ctx: RescueContext): 'pass' | 'fail' | 'unknown' {
  if (ctx.sizeAlreadyConfirmed) return 'unknown';
  const range = result.employeeRange;
  if (!range) return 'unknown';
  if (range.min >= ctx.icpMinEmployees) return 'pass';
  if (range.max !== null && range.max < ctx.icpMinEmployees) {
    return range.verification === 'quote_verified' && range.confidence >= MIN_DISCARD_CONFIDENCE ? 'fail' : 'unknown';
  }
  return 'unknown';
}

export function decideRescue(result: CompanyClassificationResult, ctx: RescueContext): RescueDecision {
  if (result.outcome !== 'classified' && result.outcome !== 'partially_classified') {
    return { kind: 'unchanged', why: result.outcome === 'nothing_verifiable' ? 'nothing_verifiable' : 'not_classified' };
  }
  const sector = sectorVerdict(result, ctx);
  const size = sizeVerdict(result, ctx);

  if (sector === 'fail') {
    const bySector = result.sector && result.sector.matchesCurrentIndustry === false ? result.sector : null;
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
  if (sector !== 'pass' && size !== 'pass' && !linkedinConfirmed) {
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
